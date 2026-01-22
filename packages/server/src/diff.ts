/**
 * Create and apply JSON Patch (RFC 6902) diffs.
 * Wraps rfc6902 with Effect error handling for audit change tracking.
 */
import { applyPatch, createPatch, type Operation } from 'rfc6902';
import { Data, Effect } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type _Patch = { readonly ops: readonly Operation[] };

// --- [ERRORS] ----------------------------------------------------------------

class PatchError extends Data.TaggedError('PatchError')<{
	readonly operations: readonly { readonly message: string }[];
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const create = <T>(before: T, after: T): _Patch | null => {
	const ops = createPatch(before, after);
	return ops.length > 0 ? { ops } : null;
};
const apply = <T extends object>(target: T, patch: _Patch): Effect.Effect<T, PatchError> => {
	const clone = structuredClone(target);
	const results = applyPatch(clone, [...patch.ops]);
	const failed = results.filter((err): err is NonNullable<typeof err> => err !== null);
	return failed.length > 0
		? Effect.fail(new PatchError({ operations: failed.map((err) => ({ message: err.message })) }))
		: Effect.succeed(clone);
};

const Diff = { apply, create } as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Diff  };
