#!/usr/bin/env tsx
import { createInterface } from 'node:readline';
/// <reference types="node" />
import { Schema as S } from '@effect/schema';
import { Effect, Option, pipe } from 'effect';

// --- Type Definitions --------------------------------------------------------

type AgentContext = S.Schema.Type<typeof AgentContextSchema>;

// --- Schema Definitions ------------------------------------------------------

const PatternSchema = S.Union(
    S.Literal('B-constant'),
    S.Literal('Branded-type'),
    S.Literal('Dispatch-table'),
    S.Literal('Effect-pipeline'),
    S.Literal('Option-monad'),
);

const AgentContextSchema = S.Struct({
    agents: S.optional(S.Array(S.String)),
    breaking: S.optional(S.Boolean),
    patterns: S.optional(S.Array(PatternSchema)),
    priority: S.optional(S.Union(S.Literal('p0'), S.Literal('p1'), S.Literal('p2'), S.Literal('p3'))),
    scope: S.optional(S.Array(S.String)),
    test_coverage: S.optional(S.Union(S.Literal('required'), S.Literal('optional'), S.Literal('none'))),
    type: S.Union(
        S.Literal('bug'),
        S.Literal('feature'),
        S.Literal('enhancement'),
        S.Literal('refactor'),
        S.Literal('docs'),
        S.Literal('test'),
        S.Literal('chore'),
        S.Literal('implementation'),
    ),
});

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        agents: [],
        breaking: false,
        patterns: [],
        priority: 'p2',
        scope: [],
        test_coverage: 'optional',
        type: 'implementation',
    } satisfies AgentContext,
    pattern: /<!-- AGENT_CONTEXT\n([\s\S]*?)\n-->/,
} as const);

// --- Pure Utility Functions --------------------------------------------------

const extractJsonBlock = (body: string): Option.Option<string> =>
    pipe(
        Option.fromNullable(body.match(B.pattern)),
        Option.flatMap((match) => Option.fromNullable(match[1])),
    );

const parseJson = Option.liftThrowable((content: string) => JSON.parse(content) as unknown);

const decodeContext = Option.liftThrowable((data: unknown) => S.decodeUnknownSync(AgentContextSchema)(data));

// --- Effect Pipeline ---------------------------------------------------------

const parseAgentContext = (body: string): Effect.Effect<AgentContext, never, never> =>
    pipe(
        Effect.succeed(body),
        Effect.map((b) =>
            pipe(
                extractJsonBlock(b),
                Option.flatMap(parseJson),
                Option.flatMap(decodeContext),
                Option.getOrElse(() => B.defaults),
            ),
        ),
    );

const readStdin = (): Effect.Effect<string, Error, never> =>
    Effect.async<string, Error>((resume) => {
        const rl = createInterface({ input: process.stdin });
        const lines: Array<string> = [];

        rl.on('line', (line) => {
            lines.push(line);
        });

        rl.on('close', () => {
            resume(Effect.succeed(lines.join('\n')));
        });

        rl.on('error', (err) => {
            resume(Effect.fail(err instanceof Error ? err : new Error(String(err))));
        });
    });

const main = (): Effect.Effect<void, Error, never> =>
    pipe(
        readStdin(),
        Effect.flatMap(parseAgentContext),
        Effect.tap((context) =>
            Effect.sync(() => {
                process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
            }),
        ),
        Effect.as(undefined),
    );

// --- Export ------------------------------------------------------------------

export { AgentContextSchema, B as PARSER_CONFIG, parseAgentContext };
export type { AgentContext };

// --- CLI Execution -----------------------------------------------------------

const isMain = process.argv[1]?.includes('parse-agent-context');

isMain &&
    Effect.runPromise(main()).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });
