#!/usr/bin/env tsx
/**
 * PR title validator using [TYPE]: format.
 * Parses [TYPE]!: description, validates against B.types, applies labels.
 */

import { B, createCtx, mutate, type RunParams, type TypeKey } from './schema.ts';

// --- Types ------------------------------------------------------------------

type PrMetaSpec = { readonly number: number; readonly title: string };
type PrMetaResult =
    | {
          readonly valid: true;
          readonly type: TypeKey;
          readonly scope: string;
          readonly breaking: boolean;
          readonly prefix: string;
      }
    | { readonly valid: false; readonly error: string };
type Parsed = { readonly type: string; readonly scope: string; readonly breaking: boolean; readonly subject: string };

// --- Valid Types ------------------------------------------------------------

const validTypes = Object.keys(B.types) as ReadonlyArray<TypeKey>;

// --- Pure Functions ---------------------------------------------------------

const parse = (title: string): Parsed | null =>
    ((m) => (m ? { breaking: !!m[2], scope: '', subject: m[3], type: m[1].toLowerCase() } : null))(
        title.match(B.pr.pattern),
    );

const validate = (p: Parsed | null): string | null =>
    p
        ? validTypes.includes(p.type as TypeKey)
            ? null
            : `Invalid type "${p.type}". Valid: ${validTypes.join(', ')}`
        : 'Invalid PR title format. Expected: [TYPE]: description';

const labels = (type: TypeKey, breaking: boolean): ReadonlyArray<string> => [type, ...(breaking ? ['breaking'] : [])];

const prefix = (type: string): string => `[${type.toUpperCase()}]`;

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: PrMetaSpec }): Promise<PrMetaResult> => {
    const ctx = createCtx(params);
    const p = parse(params.spec.title);
    const err = validate(p);

    return err || !p
        ? { error: err ?? 'Parse failed', valid: false as const }
        : mutate(ctx, {
              action: 'add',
              labels: labels(p.type as TypeKey, p.breaking),
              n: params.spec.number,
              t: 'label',
          }).then(() => ({
              breaking: p.breaking,
              prefix: prefix(p.type),
              scope: p.scope,
              type: p.type as TypeKey,
              valid: true as const,
          }));
};

// --- Export -----------------------------------------------------------------

export { run };
export type { PrMetaResult, PrMetaSpec };
