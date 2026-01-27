/**
 * RPC contract schemas for worker communication.
 * Reuses TransferError.Parse from transfer.ts; adds worker-specific errors.
 */
import { Rpc, RpcGroup } from '@effect/rpc';
import { Schema as S } from 'effect';
import { TransferError } from '../../utils/transfer.ts';

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

class TimeoutError extends S.TaggedError<TimeoutError>()('TimeoutError', {
	elapsedMs: S.Number,
	hardLimitMs: S.Number,
	softLimitMs: S.Number,
}) {}

class WorkerCrashError extends S.TaggedError<WorkerCrashError>()('WorkerCrashError', {
	reason: S.String,
	workerId: S.String,
}) {}

const TransferWorkerErrorSchema = S.Union(TransferError.Parse, TimeoutError, WorkerCrashError);

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
	ParseFormat,
	ParseProgress,
	ParseResult,
	ParseTransfer,
	TimeoutError,
	TransferRpc,
	TransferWorkerErrorSchema,
	WorkerCrashError,
};

// --- [TYPES] -----------------------------------------------------------------

type ParseProgressType = typeof ParseProgress.Type;
type ParseResultType = typeof ParseResult.Type;
type ParseFormatType = S.Schema.Type<typeof ParseFormat>;
type TransferWorkerError = S.Schema.Type<typeof TransferWorkerErrorSchema>;

export type { ParseFormatType, ParseProgressType, ParseResultType, TransferWorkerError };
