/**
 * Dispatch email through configurable provider backends.
 * Infrastructure: Multi-provider abstraction (Resend, SES, Postmark, SMTP).
 */
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from '@effect/platform';
import { Duration, Effect, identity, Match, Option, Redacted, Schema as S } from 'effect';
import { constant } from 'effect/Function';
import * as Nodemailer from 'nodemailer';
import { Env } from '../env.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [SCHEMA] ----------------------------------------------------------------

class EmailRequest extends S.Class<EmailRequest>('EmailRequest')({
    notificationId: S.UUID,
    template:       S.NonEmptyTrimmedString,
    tenantId:       S.UUID,
    to:             S.NonEmptyTrimmedString,
    vars:           S.Unknown,
}) {}

// --- [ERRORS] ----------------------------------------------------------------

class EmailError extends S.TaggedError<EmailError>()('EmailError', {
    cause:      S.optional(S.Unknown),
    provider:   S.Literal('resend', 'ses', 'postmark', 'smtp'),
    reason:     S.Literal('MissingConfig', 'ProviderError'),
    statusCode: S.optional(S.Number),
}) {
    static readonly _props = {
        MissingConfig: { retryable: false, terminal: true  },
        ProviderError: { retryable: true,  terminal: false },
    } as const;
    static readonly from = (
        reason:   EmailError['reason'],
        provider: EmailError['provider'],
        opts?: {  cause?: unknown | undefined; statusCode?: number | undefined },
    ) => new EmailError({ cause: opts?.cause, provider, reason, statusCode: opts?.statusCode });
    get isRetryable(): boolean { return EmailError._props[this.reason].retryable; }
    get isTerminal():  boolean { return EmailError._props[this.reason].terminal;  }
}

// --- [SERVICES] --------------------------------------------------------------

class EmailAdapter extends Effect.Service<EmailAdapter>()('server/EmailAdapter', {
    dependencies: [FetchHttpClient.layer],
    effect: Effect.gen(function* () {
        const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk, HttpClient.withTracerPropagation(true));
        const env = yield* Env.Service;
        const provider = env.email.provider;
        const from = env.email.from;
        const timeoutMs = env.email.timeoutMs;
        // why: reuse TCP/TLS connection across sends — createTransport is expensive per-call
        const smtpTransport = Match.value(env.email).pipe(
            Match.when({ provider: 'smtp' }, ({ smtp }) => Nodemailer.createTransport({
                auth: Option.getOrUndefined(Option.map(
                    Option.all({ pass: smtp.pass, user: smtp.user }),
                    ({ pass, user }) => ({ pass: Redacted.value(pass), user }),
                )),
                host:       smtp.host,
                port:       smtp.port,
                requireTLS: smtp.requireTls,
                secure:     smtp.secure,
            })),
            Match.orElse(() => undefined),
        );
        const send = Effect.fn('email.send')(function* (raw: S.Schema.Encoded<typeof EmailRequest>) {
            const input = yield* S.decodeUnknown(EmailRequest)(raw);
            return yield* Match.value(env.email).pipe(
                Match.when({ provider: 'resend' }, ({ resend }) =>
                    http.execute(
                        HttpClientRequest.post(resend.endpoint).pipe(
                            HttpClientRequest.setHeaders({ Authorization: `Bearer ${Redacted.value(resend.apiKey)}`, 'Content-Type': 'application/json' }),
                            HttpClientRequest.bodyUnsafeJson({
                                from,
                                headers:  { 'X-Notification-Id': input.notificationId, 'X-Tenant-Id': input.tenantId },
                                template: { id: input.template, variables: input.vars },
                                to:       [input.to],
                            }),
                        ),
                    ),
                ),
                Match.when({ provider: 'postmark' }, ({ postmark }) =>
                    http.execute(
                        HttpClientRequest.post(postmark.endpoint).pipe(
                            HttpClientRequest.setHeaders({ 'Content-Type': 'application/json', 'X-Postmark-Server-Token': Redacted.value(postmark.token) }),
                            HttpClientRequest.bodyUnsafeJson({
                                From:          from,
                                Metadata:      { notificationId: input.notificationId, tenantId: input.tenantId },
                                TemplateAlias: input.template,
                                TemplateModel: input.vars,
                                To:            input.to,
                            }),
                        ),
                    ),
                ),
                Match.when({ provider: 'ses' }, ({ ses }) =>
                    Effect.tryPromise({
                        catch: (cause) => EmailError.from('ProviderError', 'ses', {
                            cause,
                            statusCode: typeof cause === 'object' && cause !== null && '$metadata' in cause && typeof (cause as { readonly $metadata?: { readonly httpStatusCode?: number } }).$metadata?.httpStatusCode === 'number'
                                ? (cause as { readonly $metadata?: { readonly httpStatusCode?: number } }).$metadata?.httpStatusCode
                                : undefined,
                        }),
                        try: () => new SESv2Client({ region: ses.region, ...(Option.match(ses.endpoint, { onNone: constant({}), onSome: (endpoint) => ({ endpoint }) })) }).send(new SendEmailCommand({
                            Content: {
                                Template: {
                                    TemplateData: JSON.stringify(input.vars),
                                    TemplateName: input.template,
                                },
                            },
                            Destination:      { ToAddresses: [input.to] },
                            EmailTags:        [{ Name: 'notification_id', Value: input.notificationId }, { Name: 'tenant_id', Value: input.tenantId }],
                            FromEmailAddress: from,
                        })),
                    }),
                ),
                Match.when({ provider: 'smtp' }, () => Option.fromNullable(smtpTransport).pipe(
                    Option.match({
                        onNone: () => Effect.fail(EmailError.from('MissingConfig', 'smtp')),
                        onSome: (transport) => Effect.tryPromise({
                            catch: (cause) => EmailError.from('ProviderError', 'smtp', { cause }),
                            try: () => transport.sendMail({
                                from,
                                headers: { 'X-Notification-Id': input.notificationId, 'X-Tenant-Id': input.tenantId },
                                subject: input.template,
                                text:    JSON.stringify(input.vars),
                                to:      input.to,
                            }),
                        }),
                    }),
                )),
                Match.exhaustive,
            );
        },
            Effect.scoped,
            Effect.timeoutFail({
                duration: Duration.millis(timeoutMs),
                onTimeout: () => EmailError.from('ProviderError', provider, { cause: `timeout:${timeoutMs}` }),
            }),
            Effect.mapError((error) =>
                Match.value(error).pipe(
                    Match.when(Match.instanceOf(EmailError), identity),
                    Match.when(Match.instanceOf(HttpClientError.ResponseError), (e) => EmailError.from('ProviderError', provider, { cause: e, statusCode: e.response.status }),),
                    Match.orElse((cause) => EmailError.from('ProviderError', provider, { cause })),
                ),
            ),
            Effect.as({ provider }),
            Telemetry.span('email.send', { 'email.provider': provider, metrics: false }),
        );
        return { send } as const;
    }),
}) {
    static readonly Error = EmailError;
    static readonly Request = EmailRequest;
}

// --- [EXPORT] ----------------------------------------------------------------

export { EmailAdapter };
