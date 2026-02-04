/**
 * On-demand JSON Patch (RFC 6902) diff computation for audit logs.
 * PG18.1: oldData/newData snapshots stored at write-time; diffs computed on-read.
 */
import { applyPatch, createPatch, type Operation } from 'rfc6902';
import { Array as A, Data, Effect, Option, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type AuditEntry = {
	readonly oldData: Option.Option<unknown>;
	readonly newData: Option.Option<unknown>;
};
type AuditEntryWithDiff<T extends AuditEntry> = T & { readonly diff: Option.Option<Diff.Patch> };

// --- [ERRORS] ----------------------------------------------------------------

class PatchError extends Data.TaggedError('PatchError')<{ readonly operations: readonly { readonly message: string }[] }> {}

// --- [FUNCTIONS] -------------------------------------------------------------

/** Create RFC 6902 patch from before/after states. Returns null if no changes. */
const create = <T>(before: T, after: T): Diff.Patch | null => {
	const ops = createPatch(before, after);
	return ops.length > 0 ? { ops } : null;
};

/** Apply RFC 6902 patch to target object. Fails with PatchError on invalid ops. */
const apply = <T extends object>(target: T, patch: Diff.Patch): Effect.Effect<T, PatchError> => {
	const clone = structuredClone(target);
	const results = applyPatch(clone, [...patch.ops]);
	const failed = results.filter((error): error is NonNullable<typeof error> => error !== null);
	return failed.length > 0
		? Effect.fail(new PatchError({ operations: failed.map((error) => ({ message: error.message })) }))
		: Effect.succeed(clone);
};

/** Compute diff from audit entry's oldData/newData snapshots. Pure function, no Effect. */
const fromSnapshots = (oldData: Option.Option<unknown>, newData: Option.Option<unknown>): Option.Option<Diff.Patch> =>
	pipe(
		Option.all({ newData, oldData }),
		Option.flatMap(({ oldData: before, newData: after }) => Option.fromNullable(create(before, after))),
	);

/** Enrich single audit entry with computed diff. */
const enrichEntry = <T extends AuditEntry>(entry: T): AuditEntryWithDiff<T> => ({
	...entry,
	diff: fromSnapshots(entry.oldData, entry.newData),
});

/** Enrich array of audit entries with computed diffs. */
const enrichEntries = <T extends AuditEntry>(entries: readonly T[]): readonly AuditEntryWithDiff<T>[] =>
	A.map(entries, enrichEntry);

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Diff = {
	apply,
	create,
	enrichEntries,
	enrichEntry,
	fromSnapshots,
	PatchError,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Diff {
	export type Patch = { readonly ops: readonly Operation[] };
	export type PatchError = InstanceType<typeof Diff.PatchError>;
	export type WithDiff<T extends AuditEntry> = AuditEntryWithDiff<T>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Diff };
