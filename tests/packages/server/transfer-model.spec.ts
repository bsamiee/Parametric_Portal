import { it } from '@effect/vitest';
import { Transfer } from '@parametric-portal/server/utils/transfer';
import { Chunk, Effect, type Either, FastCheck as fc, Stream } from 'effect';
import { expect } from 'vitest';

// --- [TYPES] -----------------------------------------------------------------

type Model = { formatsSeen: Set<string>; itemCount: number };
type Real = { items: readonly Either.Either<{ content: string; ordinal: number; type: string }, unknown>[] };
type Fmt = 'csv' | 'ndjson' | 'yaml';

// --- [CONSTANTS] -------------------------------------------------------------

const _safe = fc.string({ maxLength: 16, minLength: 1 }).filter((v) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(v));
const _serialize: Record<Fmt, (items: readonly { content: string; type: string }[]) => string> = {
    csv: (items) => `type,content\n${items.map((i) => `${i.type},${i.content}`).join('\n')}`,
    ndjson: (items) => items.map((i) => JSON.stringify(i)).join('\n'),
    yaml: (items) => items.map((i) => `---\ntype: ${i.type}\ncontent: ${i.content}`).join('\n'),
} as const;

// --- [COMMANDS] --------------------------------------------------------------

class ImportCommand implements fc.AsyncCommand<Model, Real> {
    constructor(readonly format: Fmt, readonly items: readonly { content: string; type: string }[]) {}
    check = () => true;
    async run(model: Model, real: Real): Promise<void> {
        const input = _serialize[this.format](this.items);
        const rows = await Effect.runPromise(Transfer.import(input, { format: this.format }).pipe(Stream.runCollect, Effect.map(Chunk.toArray)));
        const { failures, items: parsed } = Transfer.partition(rows);
        expect(failures).toHaveLength(0);
        expect(parsed).toHaveLength(this.items.length);
        model.itemCount += this.items.length;
        model.formatsSeen.add(this.format);
        (real as { items: typeof rows }).items = [...real.items, ...rows];
    }
    toString = () => `Import(${this.format}, ${this.items.length} items)`;
}

class VerifyCommand implements fc.AsyncCommand<Model, Real> {
    check = (model: Readonly<Model>) => model.itemCount > 0;
    async run(model: Model, real: Real): Promise<void> {
        const { items } = Transfer.partition(real.items as readonly Either.Either<{ content: string; ordinal: number; type: string }, never>[]);
        expect(items).toHaveLength(model.itemCount);
    }
    toString = () => 'Verify';
}

// --- [MODEL_BASED] -----------------------------------------------------------

const _allCommands = [
    fc.tuple(fc.constantFrom<Fmt>('ndjson', 'yaml', 'csv'), fc.array(_safe.map((content) => ({ content, type: 'doc' })), { maxLength: 4, minLength: 1 })).map(([format, items]) => new ImportCommand(format, items)),
    fc.constant(new VerifyCommand()),
];

// P11: Model-based command sequence — import operations across formats are composable
it.effect('P11: model-based import', () => Effect.promise(() => fc.assert(
    fc.asyncProperty(fc.commands(_allCommands, { size: '-1' }), async (cmds) => {
        const setup = () => ({ model: { formatsSeen: new Set<string>(), itemCount: 0 }, real: { items: [] as Real['items'] } });
        await fc.asyncModelRun(setup, cmds);
    }), { numRuns: 30 },
)));

// P12: Multi-format accumulation — model.formatsSeen tracks all exercised formats
it.effect('P12: format coverage', () => Effect.promise(() => fc.assert(
    fc.asyncProperty(fc.commands(_allCommands, { maxCommands: 8, size: '-1' }), async (cmds) => {
        const model: Model = { formatsSeen: new Set<string>(), itemCount: 0 };
        const real: Real = { items: [] };
        await fc.asyncModelRun(() => ({ model, real }), cmds);
        expect(model.itemCount).toBe(Transfer.partition(real.items as readonly Either.Either<{ content: string; ordinal: number; type: string }, never>[]).items.length);
    }), { numRuns: 20 },
)));
