import { ManifestEntrySchema } from '@parametric-portal/ai/service';
import { Option, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const DEFAULT_LOOP_OPERATIONS = ['read.object.metadata', 'write.object.update'] as const;

// --- [SCHEMA] ----------------------------------------------------------------

const NonNegInt           = S.Int.pipe(S.greaterThanOrEqualTo(0));
const FailureClass        = S.Literal('retryable', 'correctable', 'compensatable', 'fatal');
const ResultStatus        = S.Literal('ok', 'error');
const DedupeDecision      = S.Literal('executed', 'duplicate', 'rejected');
const ErrorPayload        = S.Struct({ code: S.NonEmptyTrimmedString, details: S.optional(S.Unknown), failureClass: FailureClass, message: S.NonEmptyTrimmedString });
const _EventSubtype       = S.Literal('added', 'deleted', 'replaced', 'modified', 'undeleted', 'selected', 'deselected', 'deselect_all', 'properties_changed');
const _ObservationType    = S.Literal('objects.changed', 'layers.changed', 'view.changed', 'selection.changed', 'material.changed', 'properties.changed', 'tables.changed');
const _Identity           = S.Struct({ appId:   S.UUID, correlationId: S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)), requestId: S.UUID, sessionId: S.UUID });
const _EventBase          = S.extend(_Identity, S.Struct({ _tag: S.Literal('event'), causationRequestId: S.optional(S.UUID), eventId: S.UUID, sourceRevision: NonNegInt }));
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
const ObjectTypeTag     = S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail');
const Operation         = S.NonEmptyTrimmedString;
const _CompactionSchema = S.Struct({ estimatedTokensAfter: NonNegInt, estimatedTokensBefore: NonNegInt, mode: S.Literal('history_reset'), sequence: NonNegInt, targetTokens: NonNegInt, triggerTokens: NonNegInt });
const _EvidenceSchema   = S.Struct({ deterministicFailureClass: S.NullOr(FailureClass), deterministicStatus: ResultStatus, visualStatus: S.Literal('captured', 'capture_failed', 'capability_missing') });
const _SceneSchema      = S.Struct({ activeLayer: S.Struct({ index: S.Int, name: S.String }), activeView: S.String, layerCount: NonNegInt, objectCount: NonNegInt,
    objectCountsByType: S.Record({ key: S.String, value: NonNegInt }),
    tolerances:         S.Struct({ absoluteTolerance: S.Number, angleToleranceRadians: S.Number, unitSystem: S.String }),
    worldBoundingBox:   S.Struct({ max: S.Tuple(S.Number, S.Number, S.Number), min: S.Tuple(S.Number, S.Number, S.Number) }) });
const Loop = {
    compaction:   _CompactionSchema,
    evidence:     _EvidenceSchema,
    scene:        _SceneSchema,
    searchResult: S.Struct({ items: S.Array(S.Struct({ metadata: S.NullOr(S.Record({ key: S.String, value: S.Unknown })) })) }),
    state: S.Struct({ attempt: S.Int.pipe(S.greaterThanOrEqualTo(1)), correctionCycles: NonNegInt, identityBase: S.optional(S.Unknown),
        lastCompaction:       S.optional(_CompactionSchema), operations: S.Array(Operation), recentObservation: S.optional(S.Unknown),
        sceneSummary:         S.optional(_SceneSchema), sequence: NonNegInt, status: S.Literal('Planning', 'Completed', 'Failed'),
        verificationEvidence: S.optional(_EvidenceSchema),
        workflowExecution:    S.optional(S.Struct({ approved: S.Boolean, commandId: S.NonEmptyTrimmedString, executionId: WorkflowExecutionId })) }),
    viewCapture:     S.Struct({ activeView: S.String,  byteLength:     NonNegInt, dpi: S.Number, height: NonNegInt,
        imageBase64: S.String, mimeType:    S.String,  realtimePasses: NonNegInt, transparentBackground: S.Boolean, width: NonNegInt }),
    vision:          S.Struct({ confidence: S.Number.pipe(S.between(0, 1)), hints: S.Array(S.String) }),
    workflowPayload: S.Struct({ command:    S.Unknown, sequence: NonNegInt, workflowExecutionId: WorkflowExecutionId }),
    workflowResult:  S.Struct({ approved:   S.Boolean, result:   S.Unknown, workflowExecutionId: WorkflowExecutionId }),
} as const;
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
const ScriptResultSchema = S.Struct({
    commandName:         S.String,
    commandResult:       S.Int.pipe(S.between(0, 6)),
    objectsCreated:      S.optionalWith(S.Array(S.Struct({ objectId: S.UUID, objectType: S.String })), { default: () => [] }),
    objectsCreatedCount: NonNegInt,
    sceneObjectDelta:    S.optionalWith(S.Struct({ after: NonNegInt, before: NonNegInt }), { default: () => ({ after: 0, before: 0 }) }),
    selectionChanged:    S.optionalWith(S.Boolean, { default: () => false }),
});

// --- [TYPES] -----------------------------------------------------------------

type LoopState = {
    readonly attempt:              number; readonly correctionCycles: number; readonly identityBase: Envelope.IdentityBase;
    readonly lastCompaction:       Option.Option<typeof Loop.compaction.Type>; readonly operations: ReadonlyArray<string>;
    readonly recentObservation:    Option.Option<unknown>; readonly sceneSummary: Option.Option<unknown>;
    readonly sequence:             number; readonly status: 'Planning' | 'Completed' | 'Failed';
    readonly verificationEvidence: Option.Option<typeof Loop.evidence.Type>;
    readonly workflowExecution:    Option.Option<{ readonly approved: boolean; readonly commandId: string; readonly executionId: string }> };

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

// --- [FUNCTIONS] -------------------------------------------------------------

const _nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const _path = (value: unknown, keys: ReadonlyArray<string>) =>
    keys.reduce<Option.Option<unknown>>(
        (acc, key) =>
            Option.flatMap(acc, (current) =>
                current !== null && typeof current === 'object'
                    ? Option.fromNullable((current as Record<string, unknown>)[key])
                    : Option.none()),
        Option.some(value),
    );
const kargadanToolCallProjector = (payload: { readonly params: unknown; readonly result: unknown }): Record<string, unknown> => {
    const workflowExecutionId = _path(payload.params, ['workflowExecution', 'executionId']).pipe(
        Option.orElse(() => _path(payload.params, ['workflow', 'executionId'])),
        Option.orElse(() => _path(payload.result, ['workflow', 'executionId'])),
        Option.filter(_nonEmptyString),
    );
    const failureClass = _path(payload.params, ['verificationEvidence', 'deterministicFailureClass']).pipe(
        Option.orElse(() => _path(payload.params, ['failureClass'])),
        Option.orElse(() => _path(payload.params, ['delta', 'failureClass'])),
        Option.filter(S.is(FailureClass)),
    );
    const workflowApproved = _path(payload.params, ['workflowExecution', 'approved']).pipe(
        Option.orElse(() => _path(payload.params, ['workflow', 'approved'])),
        Option.orElse(() => _path(payload.result, ['workflow', 'approved'])),
        Option.filter((value): value is boolean => typeof value === 'boolean'),
    );
    const workflowCommandId = _path(payload.params, ['workflowExecution', 'commandId']).pipe(
        Option.orElse(() => _path(payload.params, ['workflow', 'commandId'])),
        Option.orElse(() => _path(payload.result, ['workflow', 'commandId'])),
        Option.filter(_nonEmptyString),
    );
    return {
        failureClass:        Option.getOrUndefined(failureClass),
        hasWorkflow:         Option.isSome(workflowExecutionId),
        workflowApproved:    Option.getOrUndefined(workflowApproved),
        workflowCommandId:   Option.getOrUndefined(workflowCommandId),
        workflowExecutionId: Option.getOrUndefined(workflowExecutionId),
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export { CatalogEntrySchema, DedupeDecision, DEFAULT_LOOP_OPERATIONS, Envelope, ErrorPayload, FailureClass, kargadanToolCallProjector, Loop, NonNegInt, ObjectTypeTag, Operation, ResultStatus, ScriptResultSchema, WorkflowExecutionId };
export type { LoopState };
