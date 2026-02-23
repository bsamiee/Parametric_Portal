/**
 * Model.Class definitions for Kargadan harness persistence tables.
 * KargadanSession tracks agent run lifecycle, KargadanToolCall logs every tool
 * invocation, KargadanCheckpoint stores the full loop state snapshot per session.
 */
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const SessionStatusSchema = S.Literal('running', 'completed', 'failed', 'interrupted');
const ToolCallStatusSchema = S.Literal('ok', 'error');

class KargadanSession extends Model.Class<KargadanSession>('KargadanSession')({
    endedAt:       Model.FieldOption(S.DateFromSelf),
    error:         Model.FieldOption(S.String),
    id:            Model.Generated(S.UUID),
    runId:         S.UUID,
    startedAt:     S.DateFromSelf,
    status:        SessionStatusSchema,
    toolCallCount: S.Int,
    updatedAt:     Model.DateTimeUpdateFromDate,
}) {}

class KargadanToolCall extends Model.Class<KargadanToolCall>('KargadanToolCall')({
    createdAt:  Model.DateTimeInsertFromDate,
    durationMs: S.Int,
    error:      Model.FieldOption(S.String),
    id:         Model.Generated(S.UUID),
    operation:  S.NonEmptyTrimmedString,
    params:     S.Unknown,
    result:     Model.FieldOption(S.Unknown),
    runId:      S.UUID,
    sequence:   S.Int,
    sessionId:  S.UUID,
    status:     ToolCallStatusSchema,
}) {}

class KargadanCheckpoint extends Model.Class<KargadanCheckpoint>('KargadanCheckpoint')({
    chatJson:     S.String,
    loopState:    S.Unknown,
    sceneSummary: Model.FieldOption(S.Unknown),
    sequence:     S.Int,
    sessionId:    S.UUID,
    stateHash:    S.String,
    updatedAt:    Model.DateTimeUpdateFromDate,
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { KargadanCheckpoint, KargadanSession, KargadanToolCall, SessionStatusSchema, ToolCallStatusSchema };
