/**
 * In-memory trace store for run events, snapshots, and retrieval artifacts; SHA-256 canonical state hashing enables deterministic snapshot comparison.
 * Provides appendTransition, snapshot, replay, and listArtifacts — all mutations validated against Kargadan schemas at write time.
 */
import { createHash } from 'node:crypto';
import { Kargadan } from '@parametric-portal/types/kargadan';
import { Effect, Match, Ref, Schema as S } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

// Why: recursive key-sorting produces deterministic JSON for cryptographic hashing across process restarts.
// Effect Hash.structure is non-cryptographic (32-bit) and Data.struct does not guarantee serialization order — neither replaces SHA-256.
const _canonicalState = (input: unknown): unknown =>
    Match.value(input).pipe(
        Match.when(Match.instanceOf(Array), (values) => values.map(_canonicalState)),
        Match.when(
            (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null,
            (value) =>
                Object.fromEntries(
                    Object.entries(value)
                        .toSorted(([left], [right]) => left.localeCompare(right))
                        .map(([key, nested]) => [key, _canonicalState(nested)]),
                ),
        ),
        Match.orElse((value) => value),
    );
const _stateHash = (state: unknown) =>
    createHash('sha256')
        .update(JSON.stringify(_canonicalState(state)))
        .digest('hex');
const _appendTo = <K extends 'artifacts' | 'events'>(
    store: Ref.Ref<{
        readonly artifacts: ReadonlyArray<Kargadan.RetrievalArtifact>;
        readonly events:    ReadonlyArray<Kargadan.RunEvent>;
        readonly snapshots: ReadonlyArray<Kargadan.RunSnapshot>;
    }>,
    field: K,
    schema: S.Schema<K extends 'artifacts' ? Kargadan.RetrievalArtifact : K extends 'events' ? Kargadan.RunEvent : never>,
) =>
    Effect.fn(`kargadan.trace.append.${field}`)((input: unknown) =>
        S.decodeUnknown(schema)(input).pipe(
            Effect.flatMap((decoded) =>
                Ref.update(store, (current) => ({
                    ...current,
                    [field]: [...current[field], decoded],
                })),
            ),
        ),
    );

// --- [SERVICES] --------------------------------------------------------------

class PersistenceTrace extends Effect.Service<PersistenceTrace>()('kargadan/PersistenceTrace', {
    effect: Effect.gen(function* () {
        const store = yield* Ref.make<{
            readonly artifacts: ReadonlyArray<Kargadan.RetrievalArtifact>;
            readonly events:    ReadonlyArray<Kargadan.RunEvent>;
            readonly snapshots: ReadonlyArray<Kargadan.RunSnapshot>;
        }>({
            artifacts: [],
            events:    [],
            snapshots: [],
        });
        const appendArtifact =   _appendTo(store, 'artifacts', Kargadan.RetrievalArtifactSchema);
        const appendTransition = _appendTo(store, 'events',    Kargadan.RunEventSchema);
        const snapshot = Effect.fn('kargadan.trace.snapshot')(
            (input: {
                readonly appId:    string;
                readonly runId:    string;
                readonly sequence: number;
                readonly state:    unknown;
            }) =>
                S.decode(Kargadan.RunSnapshotSchema)({
                    appId:        input.appId,
                    createdAt:    new Date(),
                    runId:        input.runId,
                    sequence:     input.sequence,
                    snapshotHash: _stateHash(input.state),
                    state:        input.state,
                }).pipe(
                    Effect.flatMap((decoded) =>
                        Ref.update(store, (current) => ({
                            ...current,
                            snapshots: [...current.snapshots, decoded],
                        })),
                    ),
                ),
        );
        const replay = Effect.fn('kargadan.trace.replay')(
            (input: { readonly runId: string; readonly expectedHash?: string | undefined }) =>
                Ref.get(store).pipe(
                    Effect.map((current) => {
                        const events = current.events
                            .filter((event) => event.runId === input.runId)
                            .toSorted((left, right) => left.sequence - right.sequence);
                        const reconstructedState = events.map((event) => ({
                            eventType: event.eventType,
                            payload:   event.payload,
                            sequence:  event.sequence,
                        }));
                        const stateHash = _stateHash(reconstructedState);
                        const snapshotHash = current.snapshots
                            .filter((snap) => snap.runId === input.runId)
                            .toSorted((left, right) => right.sequence - left.sequence)
                            .at(0)?.snapshotHash;
                        const expectedHash = input.expectedHash;
                        return {
                            events,
                            expectedHash,
                            matchesExpected: Match.value(expectedHash).pipe(
                                Match.when(
                                    (candidate): candidate is undefined => candidate === undefined,
                                    () => true,
                                ),
                                Match.orElse((candidate) => candidate === stateHash),
                            ),
                            snapshotHash,
                            stateHash,
                        } satisfies PersistenceTrace.ReplayResult;
                    }),
                ),
        );
        const listArtifacts = Effect.fn('kargadan.trace.listArtifacts')((runId: string) =>
            Ref.get(store).pipe(Effect.map((current) => current.artifacts.filter((artifact) => artifact.runId === runId)),),
        );
        return {
            appendArtifact,
            appendTransition,
            listArtifacts,
            replay,
            snapshot,
        } as const;
    }),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace PersistenceTrace {
    export type ReplayResult = {
        readonly events:          ReadonlyArray<Kargadan.RunEvent>;
        readonly expectedHash:    string | undefined;
        readonly matchesExpected: boolean;
        readonly snapshotHash:    string | undefined;
        readonly stateHash:       string;
    };
}

// --- [EXPORT] ----------------------------------------------------------------

export { PersistenceTrace };
