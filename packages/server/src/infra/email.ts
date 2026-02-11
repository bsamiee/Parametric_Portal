/**
 * Dispatch email through configurable provider backends.
 * Infrastructure: Multi-provider abstraction (Resend, SES, Postmark, SMTP).
 */
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from '@effect/platform';
import { Config, Duration, Effect, identity, Match, Option, Redacted, Schema as S } from 'effect';
import * as Nodemailer from 'nodemailer';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _httpProvider = {
	postmark: {
		endpoint: Config.string('POSTMARK_ENDPOINT').pipe(Config.withDefault('https://api.postmarkapp.com/email/withTemplate')),
		token: Config.redacted('POSTMARK_TOKEN').pipe(Config.option),
	},
	resend: {
		endpoint: Config.string('RESEND_ENDPOINT').pipe(Config.withDefault('https://api.resend.com/emails')),
		token: Config.redacted('RESEND_API_KEY').pipe(Config.option),
	},
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

class EmailRequest extends S.Class<EmailRequest>('EmailRequest')({
	notificationId: S.UUID,
	template: S.NonEmptyTrimmedString,
	tenantId: S.UUID,
	to: S.NonEmptyTrimmedString,
	vars: S.Unknown,
}) {}

// --- [ERRORS] ----------------------------------------------------------------

class EmailError extends S.TaggedError<EmailError>()('EmailError', {
	cause: S.optional(S.Unknown),
	provider: S.Literal('resend', 'ses', 'postmark', 'smtp'),
	reason: S.Literal('MissingConfig', 'ProviderError'),
	statusCode: S.optional(S.Number),
}) {
	static readonly _props = {
		MissingConfig: { retryable: false, terminal: true },
		ProviderError: { retryable: true, terminal: false },
	} as const;
	static readonly from = (
		reason: EmailError['reason'],
		provider: EmailError['provider'],
		opts?: { cause?: unknown; statusCode?: number },
	) => new EmailError({ cause: opts?.cause, provider, reason, statusCode: opts?.statusCode });
	get isRetryable(): boolean { return EmailError._props[this.reason].retryable; }
	get isTerminal(): boolean { return EmailError._props[this.reason].terminal; }
}

// --- [SERVICES] --------------------------------------------------------------

class EmailAdapter extends Effect.Service<EmailAdapter>()('server/EmailAdapter', {
	dependencies: [FetchHttpClient.layer],
	effect: Effect.gen(function* () {
		const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk, HttpClient.withTracerPropagation(true));
		const provider = yield* Config.literal('resend', 'ses', 'postmark', 'smtp')('EMAIL_PROVIDER').pipe(Config.withDefault('resend'));
		const from = yield* Config.string('EMAIL_FROM').pipe(Config.withDefault('noreply@parametric.dev'));
		const timeoutMs = yield* Config.integer('EMAIL_TIMEOUT_MS').pipe(Config.withDefault(15_000));
		const [resendEndpoint, resendToken, postmarkEndpoint, postmarkToken, sesRegion, sesEndpoint, smtpHost, smtpPass, smtpPort, smtpRequireTls, smtpSecure, smtpUser] = yield* Effect.all([
			_httpProvider.resend.endpoint,
			_httpProvider.resend.token,
			_httpProvider.postmark.endpoint,
			_httpProvider.postmark.token,
			Config.string('SES_REGION').pipe(Config.withDefault('us-east-1')),
			Config.string('SES_ENDPOINT').pipe(Config.option),
			Config.string('SMTP_HOST').pipe(Config.option),
			Config.redacted('SMTP_PASS').pipe(Config.option),
			Config.integer('SMTP_PORT').pipe(Config.withDefault(587)),
			Config.boolean('SMTP_REQUIRE_TLS').pipe(Config.withDefault(false)),
			Config.boolean('SMTP_SECURE').pipe(Config.withDefault(false)),
			Config.string('SMTP_USER').pipe(Config.option),
		], { concurrency: 'unbounded' });
		const ses = new SESv2Client({ endpoint: Option.getOrUndefined(sesEndpoint), region: sesRegion });
		const smtpTransporter = Option.map(smtpHost, (host) => Nodemailer.createTransport({
			auth: Option.isSome(smtpUser) && Option.isSome(smtpPass) ? { pass: Redacted.value(smtpPass.value), user: smtpUser.value } : undefined,
			host,
			port: smtpPort,
			requireTLS: smtpRequireTls,
			secure: smtpSecure,
		}));
		const send = (raw: S.Schema.Encoded<typeof EmailRequest>) => S.decodeUnknown(EmailRequest)(raw).pipe(
			Effect.flatMap((input) => Match.value(provider).pipe(
				Match.when('resend', () => Option.match(resendToken, {
					onNone: () => Effect.fail(EmailError.from('MissingConfig', 'resend')),
					onSome: (token) => http.execute(
						HttpClientRequest.post(resendEndpoint).pipe(
							HttpClientRequest.setHeaders({ Authorization: `Bearer ${Redacted.value(token)}`, 'Content-Type': 'application/json' }),
							HttpClientRequest.bodyUnsafeJson({
								from,
								headers: { 'X-Notification-Id': input.notificationId, 'X-Tenant-Id': input.tenantId },
								template: { id: input.template, variables: input.vars },
								to: [input.to],
							}),
						),
					),
				})),
				Match.when('postmark', () => Option.match(postmarkToken, {
					onNone: () => Effect.fail(EmailError.from('MissingConfig', 'postmark')),
					onSome: (token) => http.execute(
						HttpClientRequest.post(postmarkEndpoint).pipe(
							HttpClientRequest.setHeaders({ 'Content-Type': 'application/json', 'X-Postmark-Server-Token': Redacted.value(token) }),
							HttpClientRequest.bodyUnsafeJson({
								From: from,
								Metadata: { notificationId: input.notificationId, tenantId: input.tenantId },
								TemplateAlias: input.template,
								TemplateModel: input.vars,
								To: input.to,
							}),
						),
					),
				})),
				Match.when('ses', () => Effect.tryPromise({
					catch: (cause) => EmailError.from('ProviderError', 'ses', {
						cause,
						statusCode: typeof cause === 'object' && cause !== null && '$metadata' in cause && typeof (cause as { readonly $metadata?: { readonly httpStatusCode?: number } }).$metadata?.httpStatusCode === 'number'
							? (cause as { readonly $metadata?: { readonly httpStatusCode?: number } }).$metadata?.httpStatusCode
							: undefined,
					}),
					try: () => ses.send(new SendEmailCommand({
						Content: {
							Template: {
								TemplateData: JSON.stringify(input.vars),
								TemplateName: input.template,
							},
						},
						Destination: { ToAddresses: [input.to] },
						EmailTags: [{ Name: 'notification_id', Value: input.notificationId }, { Name: 'tenant_id', Value: input.tenantId }],
						FromEmailAddress: from,
					})),
				})),
				Match.when('smtp', () => Option.match(smtpTransporter, {
					onNone: () => Effect.fail(EmailError.from('MissingConfig', 'smtp')),
					onSome: (transporter) => Effect.tryPromise({
						catch: (cause) => EmailError.from('ProviderError', 'smtp', {
							cause,
							statusCode: typeof cause === 'object' && cause !== null && 'responseCode' in cause && typeof (cause as { readonly responseCode?: number }).responseCode === 'number'
								? (cause as { readonly responseCode?: number }).responseCode
								: undefined,
						}),
						try: () => transporter.sendMail({
							from,
							headers: { 'X-Notification-Id': input.notificationId, 'X-Tenant-Id': input.tenantId },
							subject: input.template,
							text: JSON.stringify(input.vars),
							to: input.to,
						}),
					}),
				})),
				Match.exhaustive,
			)),
			Effect.scoped,
			Effect.timeoutFail({
				duration: Duration.millis(timeoutMs),
				onTimeout: () => EmailError.from('ProviderError', provider, { cause: `timeout:${timeoutMs}` }),
			}),
			Effect.mapError((error) =>
				Match.value(error).pipe(
					Match.when(Match.instanceOf(EmailError), identity),
					Match.when(Match.instanceOf(HttpClientError.ResponseError), (e) =>
						EmailError.from('ProviderError', provider, { cause: e, statusCode: e.response.status }),
					),
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
