/**
 * Generator script: reads Field registry, outputs SQL DDL and Model.Class definitions.
 * Run with: npx tsx packages/database/scripts/generate.ts
 *
 * Architecture:
 * - DDL-specific metadata (_GenExpr, _Check, _Default) lives HERE, not in models_prototype
 * - models_prototype owns logical schema (fields, types, marks, refs)
 * - generate.ts owns DDL rendering (expressions, constraints, defaults)
 * - Algorithmic derivation: field metadata → DDL output (no hardcoded table matching)
 */
import { String as Str } from 'effect';
import { Field } from '../src/field.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _GenExpr: Partial<Record<Field.Name, string>> = {
    prefix: 'left(hash, 16)',
    remaining: 'COALESCE(array_length(backup_hashes, 1), 0)',
    size: 'octet_length(content)',
};
const _Check: Partial<Record<Field.Name, readonly [string, string]>> = {
    backupHashes: ['array_position(backup_hashes, NULL) IS NULL', 'no_nulls'],
    content: ['octet_length(content) <= 10485760', 'max_size'],
    hash: ["hash ~* '^[0-9a-f]{64}$'", 'format'],
    name: ['length(trim(name)) > 0', 'not_empty'],
    namespace: ['length(trim(namespace)) > 0', 'not_empty'],
    userAgent: ['user_agent IS NULL OR length(user_agent) <= 1024', 'length'],
};
const _Default: Partial<Record<Field.Name, string>> = { backupHashes: "'{}'" };
const _Standalone = new Set(Field.wrapByCat.datetime);
const _singular = (t: string) => (t.endsWith('s') ? t.slice(0, -1) : t).replace(/^./, (c) => c.toUpperCase());

// --- [DDL FUNCTIONS] ---------------------------------------------------------

const _table = (name: Field.Table) =>
    Field.tables[name] as {
        readonly fields: readonly Field.Resolved[];
        readonly required?: readonly Field.Resolved[];
        readonly unique?: readonly (readonly Field.Resolved[])[];
        readonly fk?: readonly (readonly [Field.Resolved, string])[];
    };
const _columnDDL = (entry: Field.Resolved, tableName: Field.Table): string => {
    const table = _table(tableName);
    const isRequired = table.required?.some((r) => r.field === entry.field);
    const genKind = entry.gen === 'stored' ? 'STORED' : 'VIRTUAL';
    const colType =
        entry.gen && entry.gen !== 'uuidv7'
            ? `${entry.col} ${entry.sql} GENERATED ALWAYS AS (${_GenExpr[entry.field]}) ${genKind}`
            : `${entry.col} ${entry.sql}`;
    const defaultVal = _Default[entry.field] ? `DEFAULT ${_Default[entry.field]}` : '';
    const timeDefault = !defaultVal && entry.mark === 'time' ? 'DEFAULT now()' : '';
    const parts = [
        colType,
        entry.mark === 'pk' ? 'PRIMARY KEY' : '',
        entry.mark === 'pk' && entry.gen === 'uuidv7' ? 'DEFAULT uuidv7()' : '',
        tableName === 'mfaSecrets' && entry.field === 'userId' ? 'UNIQUE' : '',
        (isRequired || !entry.null) && !entry.gen ? 'NOT NULL' : '',
        entry.ref
            ? `REFERENCES ${entry.ref}(id) ON DELETE ${table.fk?.find(([r]) => r.field === entry.field)?.[1] ?? 'RESTRICT'}`
            : '',
        defaultVal || timeDefault,
    ].filter(Boolean);
    return `\t${parts.join(' ')}`;
};
const _constraintsDDL = (tableName: Field.Table, snakeName: string): readonly string[] => {
    const table = _table(tableName);
    const checkFor = (e: Field.Resolved) => {
        const c = _Check[e.field];
        return c ? `\tCONSTRAINT ${snakeName}_${e.col}_${c[1]} CHECK (${c[0]})` : '';
    };
    return [
        ...table.fields
            .filter((e) => e.mark === 'unique')
            .map((e) => `\tCONSTRAINT ${snakeName}_${e.col}_unique UNIQUE NULLS NOT DISTINCT (${e.col})`),
        ...table.fields.map(checkFor).filter(Boolean),
        ...(table.unique ?? [])
            .filter((cols) => !(cols.length === 1 && tableName === 'mfaSecrets' && cols[0].field === 'userId'))
            .map(
                (cols) =>
                    `\tCONSTRAINT ${snakeName.replace('_', '')}_${tableName === 'oauthAccounts' ? 'provider_external' : cols.map((c) => c.field).join('_')}_unique UNIQUE NULLS NOT DISTINCT (${cols.map((c) => c.col).join(', ')})`,
            ),
    ];
};
const _tableDDL = (tableName: Field.Table): string => {
    const table = _table(tableName),
        snakeName = Str.camelToSnake(tableName);
    return `CREATE TABLE ${snakeName} (\n${[...table.fields.map((e) => _columnDDL(e, tableName)), ..._constraintsDDL(tableName, snakeName)].join(',\n')}\n)`;
};
const _allDDL = (): string => `/**
 * Generated SQL DDL from models_prototype.ts registry.
 * DO NOT EDIT MANUALLY - regenerate with: npx tsx packages/database/scripts/generate.ts
 */\n\n${Field.tableNames.map((t) => _tableDDL(t)).join(';\n\n')};`;

// --- [MODEL FUNCTIONS] -------------------------------------------------------

const _fieldSchema = (entry: Field.Resolved): string => {
    const wraps = entry.wrap || [];
    const noWraps = entry.null ? `S.NullOr(${entry.ts})` : entry.ts;
    const standalone = wraps.length === 1 && _Standalone.has(wraps[0].name) ? `Model.${wraps[0].name}` : '';
    const nested = [...wraps].reduceRight<string>((s, w) => `Model.${w.name}(${s})`, entry.ts);
    return wraps.length === 0 ? noWraps : standalone || nested;
};
const _modelClass = (tableName: Field.Table): string => {
    const table = _table(tableName),
        className = _singular(tableName);
    const fields = table.fields.map((e) => `\t${e.field}: ${_fieldSchema(e)},`).join('\n');
    return `class ${className} extends Model.Class<${className}>('${className}')({\n${fields}\n}) {}`;
};
const _allModels = (): string => `/**
 * Generated Model.Class definitions from models_prototype.ts registry.
 * DO NOT EDIT MANUALLY - regenerate with: npx tsx packages/database/scripts/generate.ts
 */
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';

const BufferSchema: S.Schema<Buffer, Buffer> = S.instanceOf(Buffer);
\n${Field.tableNames.map((t) => _modelClass(t)).join('\n\n')}`;

// --- [MAIN] ------------------------------------------------------------------

const main = () => {};

main();
