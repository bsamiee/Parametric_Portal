/**
 * Create and apply JSON Patch (RFC 6902) diffs.
 * Wraps rfc6902 with Effect error handling for audit change tracking.
 */
import { applyPatch, createPatch, type Operation } from 'rfc6902';
import { Data, Effect } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class PatchError extends Data.TaggedError('PatchError')<{readonly operations: readonly { readonly message: string }[];}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const create = <T>(before: T, after: T): { readonly ops: readonly Operation[] } | null => {
	const ops = createPatch(before, after);
	return ops.length > 0 ? { ops } : null;
};
const apply = <T extends object>(target: T, patch: { readonly ops: readonly Operation[] }): Effect.Effect<T, PatchError> => {
	const clone = structuredClone(target);
	const results = applyPatch(clone, [...patch.ops]);
	const failed = results.filter((err): err is NonNullable<typeof err> => err !== null);
	return failed.length > 0
		? Effect.fail(new PatchError({ operations: failed.map((err) => ({ message: err.message })) }))
		: Effect.succeed(clone);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Diff = {
	apply,
	create,
	PatchError,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Diff {
	export type Patch = NonNullable<ReturnType<typeof create>>;
	export type PatchError = InstanceType<typeof Diff.PatchError>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Diff };
