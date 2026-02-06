import { it } from '@effect/vitest';
import { Context } from '@parametric-portal/server/context';
import { Duration, Effect, FiberId, Option } from 'effect';
import { expect } from 'vitest';

it.effect('toAttrs excludes raw identity attrs and keeps correlation attrs', () => Effect.sync(() => {
	const attrs = Context.Request.toAttrs({
		appNamespace: Option.some('portal'),
		circuit: Option.some({ name: 'auth', state: 'open' }),
		cluster: Option.some({ entityId: 'entity-1', entityType: 'Job', isLeader: true, runnerId: null, shardId: null }),
		ipAddress: Option.some('127.0.0.1'),
		rateLimit: Option.some({ delay: Duration.seconds(1), limit: 100, remaining: 50, resetAfter: Duration.seconds(30) }),
		requestId: 'req-1',
		session: Option.some({ appId: 'app-1', id: 'session-1', mfaEnabled: true, userId: 'user-1', verifiedAt: Option.none() }),
		tenantId: 'tenant-1',
		userAgent: Option.some('agent'),
	}, FiberId.none);

	expect(attrs['session.id']).toBeUndefined();
	expect(attrs['user.id']).toBeUndefined();
	expect(attrs['request.id']).toBe('req-1');
	expect(attrs['tenant.id']).toBe('tenant-1');
	expect(attrs['session.mfa']).toBe('true');
}));
