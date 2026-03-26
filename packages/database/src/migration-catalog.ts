import * as Migrator from '@effect/sql/Migrator';
import migration0001Initial from '../migrations/0001_initial.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const MigrationCatalog = {
    '0001_initial': migration0001Initial,
} as const satisfies Record<string, Migrator.ResolvedMigration[2]>;
const MigrationLoader = Migrator.fromRecord({ ...MigrationCatalog });

// --- [EXPORT] ----------------------------------------------------------------

export { MigrationCatalog, MigrationLoader };
