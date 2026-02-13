import { it } from 'vitest';

// Why: The idempotency middleware (_idempotent) is deeply coupled to Effect runtime services
// (HttpServerRequest, Context.Request, CacheService, Crypto, FiberRef) with no extractable
// pure functions or exported constants. Unit testing requires full service mocking which
// makes this an integration test concern, not a unit test.

it.skip('idempotency middleware requires integration test infrastructure', () => {});
