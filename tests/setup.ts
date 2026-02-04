/**
 * Universal test infrastructure.
 * Effect equality testers + custom Vitest matchers for Effect types.
 */
import { addEqualityTesters } from '@effect/vitest';

// --- [SETUP] -----------------------------------------------------------------

addEqualityTesters();
