/**
 * RPC contract schemas for worker communication.
 * Defines type-safe request/response patterns for transfer parsing workers.
 */
import { Rpc, RpcGroup } from '@effect/rpc';
import { Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ParseProgress = typeof ParseProgress.Type;
type ParseResult = typeof ParseResult.Type;
type ParseFormat = S.Schema.Type<typeof ParseFormat>;
type TransferWorkerError = S.Schema.Type<typeof TransferWorkerErrorSchema>;

// --- [SCHEMA] ----------------------------------------------------------------

const ParseProgress = S.Struct({
	bytesProcessed: S.Number,
	eta: S.OptionFromSelf(S.Number),
	percentage: S.Number,
	rowsProcessed: S.Number,
	totalBytes: S.Number,
}).annotations({ identifier: 'ParseProgress' });

const ParseResult = S.Struct({
	errors: S.Array(S.Struct({
		code: S.String,
		detail: S.OptionFromSelf(S.String),
		ordinal: S.Number,
	})),
	items: S.Array(S.Struct({
		content: S.String,
		ordinal: S.Number,
		type: S.String,
	})),
}).annotations({ identifier: 'ParseResult' });

const ParseFormat = S.Literal('xlsx', 'csv', 'zip', 'json', 'yaml', 'xml', 'ndjson');

// --- [ERRORS] ----------------------------------------------------------------

class ParseError extends S.TaggedError<ParseError>()('ParseError', {
	code: S.Literal('DECOMPRESS', 'HASH_MISMATCH', 'INVALID_PATH', 'INVALID_RECORD', 'MISSING_TYPE', 'SCHEMA_MISMATCH', 'TOO_LARGE'),
	detail: S.optional(S.String),
	ordinal: S.optional(S.Number),
}) {}

class TimeoutError extends S.TaggedError<TimeoutError>()('TimeoutError', {
	elapsedMs: S.Number,
	hardLimitMs: S.Number,
	softLimitMs: S.Number,
}) {}

class WorkerCrashError extends S.TaggedError<WorkerCrashError>()('WorkerCrashError', {
	reason: S.String,
	workerId: S.String,
}) {}

const TransferWorkerErrorSchema = S.Union(ParseError, TimeoutError, WorkerCrashError);

// --- [RPC] -------------------------------------------------------------------

const ParseTransfer = Rpc.make('ParseTransfer', {
	error: TransferWorkerErrorSchema,
	payload: { format: ParseFormat, presignedUrl: S.String },
	stream: true,
	success: S.Union(ParseProgress, ParseResult),
});

const TransferRpc = RpcGroup.make(ParseTransfer);

// --- [EXPORT] ----------------------------------------------------------------

export {
	ParseError,
	ParseFormat,
	ParseProgress,
	ParseResult,
	ParseTransfer,
	TimeoutError,
	TransferRpc,
	TransferWorkerErrorSchema,
	WorkerCrashError,
};
export type { TransferWorkerError };
