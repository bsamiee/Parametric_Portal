/**
 * Defines the kargadan_checkpoints table schema for PostgreSQL checkpoint persistence.
 * Stores conversation history and agent loop state for session recovery on reconnect.
 */
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ConversationHistorySchema = S.Array(S.Unknown);

const LoopStateSchema = S.Struct({
    attemptCount:      S.Int,
    pendingOperations: S.Int,
    stage:             S.String,
});

const CheckpointRowSchema = S.Struct({
    conversationHistory: ConversationHistorySchema,
    createdAt:           S.DateFromString,
    loopState:           LoopStateSchema,
    sceneSummary:        S.NullOr(S.Unknown),
    sequence:            S.Int,
    sessionId:           S.String,
    stateHash:           S.String,
    updatedAt:           S.DateFromString,
});

// --- [CONSTANTS] -------------------------------------------------------------

const _tableName = 'kargadan_checkpoints' as const;

// --- [EXPORT] ----------------------------------------------------------------

export { _tableName, CheckpointRowSchema, ConversationHistorySchema, LoopStateSchema };
