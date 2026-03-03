import { Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const DEFAULT_LOOP_OPERATIONS = ['read.object.metadata', 'write.object.update'] as const;

// --- [SCHEMA] ----------------------------------------------------------------

const NonNegInt =        S.Int.pipe(S.greaterThanOrEqualTo(0));
const _DedupeDecision =  S.Literal('executed', 'duplicate', 'rejected');
const _FailureClass =    S.Literal('retryable', 'correctable', 'compensatable', 'fatal');
const _EventSubtype =    S.Literal('added', 'deleted', 'replaced', 'modified', 'undeleted', 'selected', 'deselected', 'deselect_all', 'properties_changed');
const _ObservationType = S.Literal('objects.changed', 'layers.changed', 'view.changed', 'selection.changed', 'material.changed', 'properties.changed', 'tables.changed');
const _Identity =        S.Struct({ appId:   S.UUID, correlationId: S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)), requestId: S.UUID, sessionId: S.UUID });
const _EventBase =       S.extend(_Identity, S.Struct({ _tag: S.Literal('event'), causationRequestId: S.optional(S.UUID), eventId: S.UUID, sourceRevision: NonNegInt }));
const ObjectTypeTag =    S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail');
const Operation =        S.Literal(
    'read.scene.summary',  'read.object.metadata', 'read.object.geometry', 'read.layer.state',   'read.view.state',       'read.tolerance.units',
    'write.object.create', 'write.object.update',  'write.object.delete',  'write.layer.update', 'write.viewport.update', 'write.annotation.update',
    'script.run',
);
const Envelope = S.Union(
    S.extend(_Identity, S.Struct({ _tag: S.Literal('command'),
        deadlineMs:  S.Int.pipe(S.greaterThan(0)),
        idempotency: S.optional(S.Struct({ idempotencyKey: S.String.pipe(S.pattern(/^[A-Za-z0-9:_-]{8,128}$/)), payloadHash: S.String.pipe(S.pattern(/^[a-f0-9]{64}$/)) })),
        objectRefs:  S.optional(S.Array(S.Struct({ objectId: S.UUID, sourceRevision: NonNegInt, typeTag: ObjectTypeTag }))),
        operation:   Operation,
        payload:     S.Unknown,
        undoScope:   S.optional(S.NonEmptyTrimmedString) })),
    S.extend(_Identity, S.Struct({ _tag: S.Literal('handshake.init'),
        auth:            S.Struct({ token: S.NonEmptyTrimmedString, tokenExpiresAt: S.DateFromString }),
        capabilities:    S.Struct({ optional: S.Array(S.NonEmptyTrimmedString), required: S.Array(S.NonEmptyTrimmedString) }),
        protocolVersion: S.Struct({ major: NonNegInt, minor: NonNegInt }),
    })),
    S.extend(_Identity, S.Struct({ _tag: S.Literal('handshake.ack') })),
    S.extend(_Identity, S.Struct({ _tag: S.Literal('handshake.reject'),
        code:         S.NonEmptyTrimmedString,
        failureClass: _FailureClass,
        message:      S.NonEmptyTrimmedString
    })),
    S.extend(_Identity, S.Struct({ _tag: S.Literal('command.ack') })),
    S.extend(_Identity, S.Struct({ _tag: S.Literal('heartbeat'), mode: S.Literal('ping', 'pong') })),
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
                dedupeDecision: S.optional(_DedupeDecision),
                errorCode:      S.optional(S.NonEmptyTrimmedString),
                failureClass:   S.optional(_FailureClass),
                status:         S.Literal('ok', 'error'),
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
        dedupe: S.optional(S.Struct({ decision: _DedupeDecision, originalRequestId: S.UUID })),
        error:  S.optional(S.Struct({ code: S.NonEmptyTrimmedString, details: S.optional(S.Unknown), failureClass: _FailureClass, message: S.NonEmptyTrimmedString })),
        status: S.Literal('ok', 'error') })),
);

// --- [TYPES] -----------------------------------------------------------------

type _Envelope =  typeof Envelope.Type;
type _Heartbeat = Extract<_Envelope, { readonly _tag: 'heartbeat' }>;

namespace Envelope {
    export type FailureClass =  typeof _FailureClass.Type;
    export type Identity =      typeof _Identity.Type;
    export type IdentityBase =  Omit<Identity, 'requestId'>;
    export type Command =       Extract<_Envelope, { readonly _tag: 'command' }>;
    export type Event =         Extract<_Envelope, { readonly _tag: 'event' }>;
    export type Result =        Extract<_Envelope, { readonly _tag: 'result' }>;
    export type Outbound =      Command | Extract<_Envelope, { readonly _tag: 'handshake.init' }> | (_Heartbeat & { readonly mode: 'ping' });
    export type PendingReply =  Extract<_Envelope, { readonly _tag: 'handshake.ack' | 'handshake.reject' | 'command.ack' | 'result' }> | (_Heartbeat & { readonly mode: 'pong' });
}

// --- [EXPORT] ----------------------------------------------------------------

export { DEFAULT_LOOP_OPERATIONS, Envelope, NonNegInt, ObjectTypeTag, Operation };
