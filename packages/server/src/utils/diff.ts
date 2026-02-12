/**
 * On-demand JSON Patch (RFC 6902) diff computation for audit logs.
 * PG18.1: oldData/newData snapshots stored at write-time; diffs computed on-read.
 */
import { applyPatch, createPatch, type Operation } from 'rfc6902';
import { Array as A, Data, Effect, Option, pipe } from 'effect';
import { Telemetry } from '../observe/telemetry.ts';

// --- [ERRORS] ----------------------------------------------------------------

class PatchError extends Data.TaggedError('PatchError')<{ readonly operations: readonly { readonly message: string }[] }> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const create = <T>(before: T, after: T): Diff.Patch | null => {
    const ops = createPatch(before, after);
    return ops.length > 0 ? { ops } : null;
};
const apply = <T extends object>(target: T, patch: Diff.Patch): Effect.Effect<T, PatchError> => {
    const clone = structuredClone(target);
    const results = applyPatch(clone, [...patch.ops]);
    const failed = results.filter((error): error is NonNullable<typeof error> => error !== null);
    return (failed.length > 0
        ? Effect.fail(new PatchError({ operations: failed.map((error) => ({ message: error.message })) }))
        : Effect.succeed(clone)).pipe(
        Telemetry.span('diff.apply', { 'diff.ops': patch.ops.length, metrics: false }),
    );
};
const fromSnapshots = (oldData: Option.Option<unknown>, newData: Option.Option<unknown>): Option.Option<Diff.Patch> =>
    pipe(Option.all({ newData, oldData }), Option.flatMap(({ oldData: before, newData: after }) => Option.fromNullable(create(before, after))));
const enrich: {
    <T extends Diff.Entry>(entry: T): T & { readonly diff: Option.Option<Diff.Patch> };
    <T extends Diff.Entry>(entries: readonly T[]): (T & { readonly diff: Option.Option<Diff.Patch> })[];
} = <T extends Diff.Entry>(input: T | readonly T[]): never => {
    const one = (entry: T): T & { readonly diff: Option.Option<Diff.Patch> } => ({
        ...entry,
        diff: pipe(Option.all({ newData: entry.newData, oldData: entry.oldData }), Option.flatMap(({ oldData: before, newData: after }) => Option.fromNullable(create(before, after)))),
    });
    return (Array.isArray(input) ? A.map(input as readonly T[], one) : one(input as T)) as never;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Diff = {
    apply,
    create,
    enrich,
    fromSnapshots,
    PatchError
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Diff {
    export type Entry = { readonly oldData: Option.Option<unknown>; readonly newData: Option.Option<unknown> };
    export type Patch = { readonly ops: readonly Operation[] };
    export type PatchError = InstanceType<typeof Diff.PatchError>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Diff };
