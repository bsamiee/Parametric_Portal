/** JobService tests: state machine transitions, error classification, static method delegation. */
import { it } from '@effect/vitest';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { Effect, Exit, FastCheck as fc, Option, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _status =    fc.constantFrom<'queued' | 'processing' | 'complete' | 'failed' | 'cancelled'>('queued', 'processing', 'complete', 'failed', 'cancelled');
const _reason =    fc.constantFrom<'NotFound' | 'AlreadyCancelled' | 'HandlerMissing' | 'Validation' | 'Processing' | 'MaxRetries' | 'RunnerUnavailable' | 'Timeout'>('NotFound', 'AlreadyCancelled', 'HandlerMissing', 'Validation', 'Processing', 'MaxRetries', 'RunnerUnavailable', 'Timeout');
const _timestamp = fc.nat({ max: 2_000_000_000_000 });
const _RETRYABLE = new Set<string>(['Processing', 'RunnerUnavailable', 'Timeout']);
const _TERMINAL =  new Set(['cancelled', 'complete', 'failed']);
const _REACHABLE_FROM_QUEUED = new Set(['queued', 'processing', 'cancelled']);
const _DLQ_ENTRY = { appId: '00000000-0000-7000-8000-000000000444', payload: { notificationId: 'n-1' }, type: 'notification.send' } as const;
const _mkDb = (one: () => Effect.Effect<Option.Option<unknown>>) => ({ jobDlq: { markReplayed: () => Effect.succeed(1), one } }) as never;
const _VALID_TRANSITIONS: Record<string, ReadonlySet<string>> = {
    cancelled: new Set(), complete: new Set(),
    failed:    new Set(['processing']), processing: new Set(['complete', 'failed', 'cancelled']),
    queued:    new Set(['processing', 'cancelled']),
} as const;

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: Error complement law — retryable XOR terminal, deterministic, with cause propagation.
it.effect.prop('P1: error complement + determinism + cause', { reason: _reason }, ({ reason }) =>
    Effect.sync(() => {
        const cause = { detail: 'upstream-timeout' } as const;
        const error = JobService.Error.from('job-1', reason, cause);
        expect(error).toEqual(expect.objectContaining({ _tag: 'JobError', cause, jobId: 'job-1', reason }));
        expect(error.isRetryable).toBe(_RETRYABLE.has(reason));
        expect(error.isRetryable).toBe(!error.isTerminal);
        expect(JobService.Error.from('job-1', reason).isRetryable).toBe(error.isRetryable);
    }),
);
// Why: State machine transition law — valid transitions apply, invalid return base; null initializes as queued.
it.effect.prop('P2: transition valid/invalid + null init', { from: _status, to: _status, ts: _timestamp }, ({ from, to, ts }) =>
    Effect.sync(() => {
        const fromNull = JobService.State.transition(null, from, ts);
        const expectedStatus = _REACHABLE_FROM_QUEUED.has(from) ? from : 'queued';
        expect(fromNull.status).toBe(expectedStatus);
        expect(fromNull.createdAt).toBe(ts);
        const baseTarget = from === 'queued' || from === 'processing' ? 'processing' : from;
        const base = JobService.State.transition(
            JobService.State.transition(null, 'queued', ts),
            baseTarget,
            ts,
        );
        const next = JobService.State.transition(base, to, ts + 1, { attempts: 5, error: 'e1', result: 'r1' });
        const isValid = _VALID_TRANSITIONS[base.status]?.has(to) ?? false;
        const shouldApply = isValid || base.status === to;
        expect(next.status).toBe(shouldApply ? to : base.status);
        expect(shouldApply ? next.history.at(-1)?.error : undefined).toBe(shouldApply ? 'e1' : undefined);
    }),
);
// Why: Terminal completedAt set, non-terminal undefined; status model exhaustive against external set.
it.effect('P3: terminal completedAt + status model completeness', () =>
    Effect.sync(() => {
        const processing = JobService.State.transition(null, 'processing', 10);
        expect(processing.completedAt).toBeUndefined();
        const complete = JobService.State.transition(processing, 'complete', 20);
        expect(complete.completedAt).toBe(20);
        const failed = JobService.State.transition(JobService.State.transition(null, 'processing', 30), 'failed', 40,);
        expect(failed.completedAt).toBe(40);
        const cancelled = JobService.State.transition(null, 'cancelled', 50);
        expect(cancelled.completedAt).toBe(50);
        expect((['queued', 'processing', 'complete', 'failed', 'cancelled'] as const).map((s) => JobService.StatusModel[s].terminal)).toEqual((['queued', 'processing', 'complete', 'failed', 'cancelled'] as const).map((s) => _TERMINAL.has(s)));
    }),
);

// --- [EDGE_CASES] ------------------------------------------------------------

// Why: toResponse projection preserves fields; errorHistory filters no-error entries; defaultResponse shape.
it.effect('E1: toResponse + errorHistory + defaultResponse', () =>
    Effect.sync(() => {
        const state = JobService.State.transition(
            JobService.State.transition(null, 'processing', 100, { attempts: 1, error: 'err1' }),
            'failed', 200, { error: 'err2' },
        );
        const response = state.toResponse();
        expect(response.status).toBe('failed');
        expect(response.history).toHaveLength(2);
        expect(response.attempts).toBe(1);
        expect(state.errorHistory).toEqual([{ error: 'err1', timestamp: 100 }, { error: 'err2', timestamp: 200 },]);
        expect(JobService.State.transition(null, 'processing', 300).errorHistory).toHaveLength(0);
        expect(JobService.State.defaultResponse).toEqual(expect.objectContaining({ attempts: 0, history: [], status: 'queued' }),);
    }),
);
// Why: replay NotFound for missing entry + success for existing + isLocal delegation.
it.effect('E2: replay + isLocal delegation', () =>
    Effect.gen(function* () {
        const _jobs = { submit: () => Effect.succeed('job-1') } as never;
        const [replayMissing, replayFound, local] = yield* Effect.all([
            JobService.replay('dlq-missing').pipe(
                Effect.provideService(JobService, _jobs),
                Effect.provideService(DatabaseService, _mkDb(() => Effect.succeed(Option.none()))),
                Effect.exit,
            ),
            JobService.replay('dlq-1').pipe(
                Effect.provideService(JobService, _jobs),
                Effect.provideService(DatabaseService, _mkDb(() => Effect.succeed(Option.some(_DLQ_ENTRY)))),
                Effect.exit,
            ),
            JobService.isLocal('job:1').pipe(
                Effect.provideService(ClusterService, { isLocal: () => Effect.succeed(true) } as never),
            ),
        ]);
        expect(Exit.isFailure(replayMissing)).toBe(true);
        expect(String(replayMissing)).toContain('NotFound');
        expect(Exit.isSuccess(replayFound)).toBe(true);
        expect(local).toBe(true);
    }),
);
// Why: Transition opts propagation — result, attempts, lastError carried through valid paths.
it.effect('E3: transition opts + Payload/StatusEvent schema decode', () =>
    Effect.gen(function* () {
        const s1 = JobService.State.transition(null, 'processing', 10, { attempts: 1 });
        const s2 = JobService.State.transition(s1, 'complete', 20, { result: { data: 42 } });
        expect(s2.result).toEqual({ data: 42 });
        expect(s2.completedAt).toBe(20);
        expect(s2.lastError).toBeUndefined();
        const s3 = JobService.State.transition(null, 'processing', 30, { error: 'timeout' });
        const s4 = JobService.State.transition(s3, 'failed', 40, { error: 'final' });
        expect(s4.lastError).toBe('final');
        expect(s4.history).toHaveLength(2);
        const payload = yield* S.decodeUnknown(JobService.Payload)({ payload: {}, tenantId: 't-1', type: 'test' });
        expect(payload.priority).toBe('normal');
        expect(payload.duration).toBe('short');
        expect(payload.maxAttempts).toBe(3);
        expect(payload.schemaVersion).toBe(1);
        const event = yield* S.decodeUnknown(JobService.StatusEvent)({ jobId: 'j-1', status: 'complete', tenantId: 't-1', type: 'test' });
        expect(event.jobId).toBe('j-1');
        expect(event.status).toBe('complete');
    }),
);
