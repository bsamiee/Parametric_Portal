import { ManifestEntrySchema } from '@parametric-portal/ai/service';
import { Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const DEFAULT_LOOP_OPERATIONS = ['read.object.metadata', 'write.object.update'] as const;

// --- [SCHEMA] ----------------------------------------------------------------

const NonNegInt =        S.Int.pipe(S.greaterThanOrEqualTo(0));
const FailureClass =     S.Literal('retryable', 'correctable', 'compensatable', 'fatal');
const ResultStatus =     S.Literal('ok', 'error');
const DedupeDecision =   S.Literal('executed', 'duplicate', 'rejected');
const ErrorPayload =     S.Struct({ code: S.NonEmptyTrimmedString, details: S.optional(S.Unknown), failureClass: FailureClass, message: S.NonEmptyTrimmedString });
const _EventSubtype =    S.Literal('added', 'deleted', 'replaced', 'modified', 'undeleted', 'selected', 'deselected', 'deselect_all', 'properties_changed');
const _ObservationType = S.Literal('objects.changed', 'layers.changed', 'view.changed', 'selection.changed', 'material.changed', 'properties.changed', 'tables.changed');
const _Identity =        S.Struct({ appId:   S.UUID, correlationId: S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)), requestId: S.UUID, sessionId: S.UUID });
const _EventBase =       S.extend(_Identity, S.Struct({ _tag: S.Literal('event'), causationRequestId: S.optional(S.UUID), eventId: S.UUID, sourceRevision: NonNegInt }));
const WorkflowExecutionId = S.NonEmptyTrimmedString.annotations({ identifier:'WorkflowExecutionId' });
const _TracedBase = S.extend(_Identity, S.Struct({ telemetryContext: S.Struct({
    attempt:      S.Int.pipe(S.greaterThanOrEqualTo(1)),
    operationTag: S.NonEmptyTrimmedString,
    spanId:       S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)),
    traceId:      S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)),
}) }));
const CatalogEntrySchema = S.Struct({
    ...ManifestEntrySchema.fields,
    category:      S.NonEmptyTrimmedString,
    dispatch:      S.Struct({ mode: S.Literal('direct', 'script') }),
    examples:      S.Array(S.Struct({ description: S.NonEmptyString, input: S.NonEmptyString })),
    isDestructive: S.Boolean,
    params:        S.Array(S.Struct({ description: S.NonEmptyString, name: S.NonEmptyTrimmedString, required: S.Boolean, type: S.NonEmptyTrimmedString })),
    requirements:  S.optionalWith(S.Struct({
        minimumObjectRefCount:    S.optionalWith(NonNegInt, { default: () => 0     }),
        requiresObjectRefs:       S.optionalWith(S.Boolean, { default: () => false }),
        requiresTelemetryContext: S.optionalWith(S.Boolean, { default: () => true  }),
    }), { default: () => ({ minimumObjectRefCount: 0, requiresObjectRefs: false, requiresTelemetryContext: true }) }),
});
const ObjectTypeTag =    S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail');
const Operation =        S.NonEmptyTrimmedString;
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Envelope = S.Union(
    S.extend(_TracedBase, S.Struct({ _tag: S.Literal('command'),
        args:        S.Record({ key: S.String, value: S.Unknown }),
        commandId:   Operation,
        deadlineMs:  S.Int.pipe(S.greaterThan(0)),
        idempotency: S.optional(S.Struct({ idempotencyKey: S.String.pipe(S.pattern(/^[A-Za-z0-9:_-]{8,128}$/)), payloadHash: S.String.pipe(S.pattern(/^[a-f0-9]{64}$/)) })),
        objectRefs:  S.optional(S.Array(S.Struct({ objectId: S.UUID, sourceRevision: NonNegInt, typeTag: ObjectTypeTag }))),
        operation:   S.optional(Operation),
        payload:     S.optional(S.Record({ key: S.String, value: S.Unknown })),
        undoScope:   S.optional(S.NonEmptyTrimmedString) })),
    S.extend(_TracedBase, S.Struct({ _tag:     S.Literal('handshake.init'),
        auth:             S.Struct({ token:    S.NonEmptyTrimmedString, tokenExpiresAt: S.DateFromString }),
        capabilities:     S.Struct({ optional: S.Array(S.NonEmptyTrimmedString), required: S.Array(S.NonEmptyTrimmedString) }),
        protocolVersion:  S.Struct({ major:    NonNegInt, minor: NonNegInt }),
    })),
    S.extend(_TracedBase, S.Struct({
        _tag:                 S.Literal('handshake.ack'),
        acceptedCapabilities: S.optionalWith(S.Array(S.NonEmptyTrimmedString), { default: () => [] }),
        catalog:              S.optionalWith(S.Array(CatalogEntrySchema),      { default: () => [] }),
        server:               S.optional(S.Struct({ pluginRevision: S.NonEmptyTrimmedString, rhinoVersion: S.NonEmptyTrimmedString })),
    })),
    S.extend(_TracedBase, S.Struct({ _tag: S.Literal('handshake.reject'),
        code:             S.NonEmptyTrimmedString,
        failureClass:     FailureClass,
        message:          S.NonEmptyTrimmedString,
    })),
    S.extend(_Identity, S.Struct({ _tag: S.Literal('command.ack') })),
    S.extend(_Identity, S.Struct({ _tag: S.Literal('heartbeat'), mode: S.Literal('ping', 'pong') })),
    S.Struct({
        _tag:      S.Literal('error'),
        message:   S.NonEmptyTrimmedString,
        requestId: S.optional(S.UUID),
    }),
    S.Union(
        S.extend(_EventBase, S.Struct({
            delta: S.Struct({
                isUndoRedo:  S.optional(S.Boolean),
                objectId:    S.optional(S.UUID),
                oldObjectId: S.optional(S.UUID),
                subtype:     _EventSubtype,
                typeTag:     S.optional(ObjectTypeTag),
            }),
            eventType: _ObservationType,
        })),
        S.extend(_EventBase, S.Struct({
            delta:     S.Struct({ isUndo: S.Boolean, requestId: S.UUID, undoSerial: NonNegInt }),
            eventType: S.Literal('undo.redo')
        })),
        S.extend(_EventBase, S.Struct({
            delta: S.Struct({
                dedupeDecision: S.optional(DedupeDecision),
                errorCode:      S.optional(S.NonEmptyTrimmedString),
                failureClass:   S.optional(FailureClass),
                status:         ResultStatus,
            }),
            eventType: S.Literal('session.lifecycle')
        })),
        S.extend(_EventBase, S.Struct({
            delta: S.Struct({
                batchWindowMs: NonNegInt,
                categories:    S.Array(S.Struct({
                    category:  S.Union(_ObservationType, S.Literal('undo.redo', 'session.lifecycle', 'stream.compacted')),
                    count:     NonNegInt,
                    subtypes:  S.Array(S.Struct({ count: NonNegInt, subtype: _EventSubtype }))
                })),
                containsUndoRedo: S.Boolean,
                totalCount:       NonNegInt,
            }),
            eventType: S.Literal('stream.compacted')
        })),
    ),
    S.extend(_Identity, S.Struct({
        _tag:   S.Literal('result'),
        dedupe: S.optional(S.Struct({ decision: DedupeDecision, originalRequestId: S.UUID })),
        error:  S.optional(ErrorPayload),
        result: S.optional(S.Unknown),
        status: ResultStatus })),
);

// --- [TYPES] -----------------------------------------------------------------

namespace Envelope {
    export type CatalogEntry = typeof CatalogEntrySchema.Type;
    export type FailureClass = typeof FailureClass.Type;
    export type ErrorPayload = typeof ErrorPayload.Type;
    export type Identity     = typeof _Identity.Type;
    export type IdentityBase = Omit<Identity, 'requestId'>;
    export type Command      = Extract<typeof Envelope.Type, { readonly _tag: 'command' }>;
    export type Event        = Extract<typeof Envelope.Type, { readonly _tag: 'event' }>;
    export type RemoteError  = Extract<typeof Envelope.Type, { readonly _tag: 'error' }>;
    export type Result       = Extract<typeof Envelope.Type, { readonly _tag: 'result' }>;
    export type Outbound     = Command
        | Extract<typeof  Envelope.Type, { readonly _tag: 'handshake.init' }>
        | (Extract<typeof Envelope.Type, { readonly _tag: 'heartbeat' }> & { readonly mode: 'ping' });
    export type PendingReply =  Extract<typeof Envelope.Type, { readonly _tag: 'handshake.ack' | 'handshake.reject' | 'command.ack' | 'result' }>
        | (Extract<typeof Envelope.Type, { readonly _tag: 'heartbeat' }> & { readonly mode: 'pong' });
}

// --- [EXPORT] ----------------------------------------------------------------

export { CatalogEntrySchema, DedupeDecision, DEFAULT_LOOP_OPERATIONS, Envelope, ErrorPayload, FailureClass, NonNegInt, ObjectTypeTag, Operation, ResultStatus, WorkflowExecutionId };
