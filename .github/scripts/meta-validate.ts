#!/usr/bin/env tsx
/**
 * Pure validation functions for GitHub object metadata.
 * No mutations - polymorphic dispatch over targets (title, commit, label, body).
 */

import { B, type Commit, fmt, type Label, type Target, TYPES, type TypeKey, type ValidateResult } from './schema.ts';

// --- Constants (derived from schema.ts) --------------------------------------

const validTypes = TYPES as ReadonlyArray<string>;

// --- Pure Parsers -----------------------------------------------------------

const parseTitle = (title: string): ValidateResult => {
    const m = title.match(B.pr.pattern);
    return m && validTypes.includes(m[1].toLowerCase())
        ? { breaking: !!m[2], subject: m[3], type: m[1].toLowerCase() as TypeKey, valid: true }
        : {
              error: m ? `Invalid type "${m[1]}". Valid: ${validTypes.join(', ')}` : 'Expected: [TYPE]: desc',
              valid: false,
          };
};

const parseCommit = (msg: string): ValidateResult => {
    const m = msg.match(/^(\w+)(!?)(?:\(.+\))?:\s*(.+)$/);
    return m && validTypes.includes(m[1].toLowerCase())
        ? { breaking: !!m[2], subject: m[3], type: m[1].toLowerCase() as TypeKey, valid: true }
        : { error: 'Expected: type(scope)?: desc', valid: false };
};

const checkLabels = (labels: ReadonlyArray<Label>): ValidateResult => {
    const type = labels.map((l) => l.name).find((n) => validTypes.includes(n)) as TypeKey | undefined;
    return type
        ? { breaking: labels.some((l) => l.name === B.breaking.label), subject: '', type, valid: true }
        : { error: 'Missing type label', valid: false };
};

const checkBody = (body: string | null): ValidateResult =>
    body && body.trim().length >= 20
        ? { breaking: B.breaking.bodyPat.test(body), subject: body.trim(), type: 'chore', valid: true }
        : { error: 'Body too short (<20 chars)', valid: false };

// --- Polymorphic Validators -------------------------------------------------

const validators: Record<Target, (input: string | ReadonlyArray<Label>) => ValidateResult> = {
    body: (s) => checkBody(s as string),
    commit: (s) => parseCommit(s as string),
    label: (l) => checkLabels(l as ReadonlyArray<Label>),
    title: (s) => parseTitle(s as string),
};

const validate = (target: Target, input: string | ReadonlyArray<Label>): ValidateResult => validators[target](input);

// --- Breaking Detection (unified) -------------------------------------------

const isBreaking = (title: string, body: string | null, commits?: ReadonlyArray<Commit>): boolean =>
    B.pr.pattern.exec(title)?.[2] === '!' ||
    (body ? B.breaking.bodyPat.test(body) : false) ||
    (commits?.some((c) => B.breaking.commitPat.some((p) => p.test(c.commit.message))) ?? false);

// --- Inference Helpers ------------------------------------------------------

const inferType = (input: string): TypeKey => (B.meta.infer.find((r) => r.p.test(input))?.v as TypeKey) ?? 'chore';

const cleanTitle = (title: string): string =>
    title
        .replace(/^\[.*?\]:?\s*/i, '')
        .replace(/^(\w+)(\(.*?\))?:?\s*/i, '')
        .trim();

const formatTitle = (type: TypeKey, subject: string, breaking: boolean): string =>
    `${fmt.title(type, breaking)} ${subject}`;

const formatCommit = (type: TypeKey, scope: string | null, subject: string, breaking: boolean): string =>
    `${type}${scope ? `(${scope})` : ''}${breaking ? '!' : ''}: ${subject}`;

const needsFix = (target: Target, input: string | ReadonlyArray<Label>): boolean => !validate(target, input).valid;

const hasTypeLabel = (labels: ReadonlyArray<Label>): boolean => labels.some((l) => validTypes.includes(l.name));

const getTypeLabel = (labels: ReadonlyArray<Label>): TypeKey | undefined =>
    labels.map((l) => l.name).find((n) => validTypes.includes(n)) as TypeKey | undefined;

// --- Export -----------------------------------------------------------------

export {
    cleanTitle,
    formatCommit,
    formatTitle,
    getTypeLabel,
    hasTypeLabel,
    inferType,
    isBreaking,
    needsFix,
    parseCommit,
    parseTitle,
    validate,
    validTypes,
};
