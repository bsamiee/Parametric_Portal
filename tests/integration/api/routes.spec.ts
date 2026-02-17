/** API routes integration tests: endpoint method/path contracts across all 12 ParametricApi groups.
 * Oracle: HttpApi group metadata — method + path are structural, not implementation-derived. */
import { it } from '@effect/vitest';
import { ParametricApi } from '@parametric-portal/server/api';
import { Effect } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const GROUPS = ParametricApi.groups as Record<string, {
    readonly endpoints: Record<string, { readonly method: string; readonly path: string }>;
}>;

// --- [FUNCTIONS] -------------------------------------------------------------

const _endpoint = (group: string, name: string) => GROUPS[group]?.endpoints[name];

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: auth/admin/users/audit groups expose expected endpoint methods + paths', () =>
    Effect.sync(() => {
        expect(_endpoint('auth',  'oauthStart')).toMatchObject({             method: 'GET',  path: '/api/oauth/:provider'            });
        expect(_endpoint('auth',  'refresh')).toMatchObject({                method: 'POST', path: '/api/refresh'                    });
        expect(_endpoint('admin', 'createTenant')).toMatchObject({           method: 'POST', path: '/api/tenants'                    });
        expect(_endpoint('admin', 'replayDlq')).toMatchObject({              method: 'POST', path: '/api/dlq/:id/replay'             });
        expect(_endpoint('users', 'subscribeNotifications')).toMatchObject({ method: 'GET',  path: '/api/me/notifications/subscribe' });
        expect(_endpoint('audit', 'getByEntity')).toMatchObject({            method: 'GET',  path: '/api/entity/:subject/:subjectId' });
    }));
it.effect('P2: health/jobs/telemetry/websocket groups keep realtime + health contracts', () =>
    Effect.sync(() => {
        expect(_endpoint('health',    'readiness')).toMatchObject({          method: 'GET',  path: '/api/readiness' });
        expect(_endpoint('health',    'clusterHealth')).toMatchObject({      method: 'GET',  path: '/api/cluster'   });
        expect(_endpoint('jobs',      'subscribe')).toMatchObject({          method: 'GET',  path: '/api/subscribe' });
        expect(_endpoint('telemetry', 'ingestTraces')).toMatchObject({       method: 'POST', path: '/api/traces'    });
        expect(_endpoint('telemetry', 'ingestLogs')).toMatchObject({         method: 'POST', path: '/api/logs'      });
        expect(_endpoint('websocket', 'connect')).toMatchObject({            method: 'GET',  path: '/api'           });
    }));
it.effect('P3: storage/search/transfer/webhooks groups keep data-plane endpoint contracts', () =>
    Effect.sync(() => {
        expect(_endpoint('storage',  'sign')).toMatchObject({                method: 'POST', path: '/api/sign'               });
        expect(_endpoint('storage',  'listAssets')).toMatchObject({          method: 'GET',  path: '/api/assets'             });
        expect(_endpoint('search',   'refreshEmbeddings')).toMatchObject({   method: 'POST', path: '/api/refresh/embeddings' });
        expect(_endpoint('transfer', 'export')).toMatchObject({              method: 'GET',  path: '/api/export'             });
        expect(_endpoint('transfer', 'import')).toMatchObject({              method: 'POST', path: '/api/import'             });
        expect(_endpoint('webhooks', 'retry')).toMatchObject({               method: 'POST', path: '/api/retry/:id'          });
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: all 12 groups are registered', () =>
    Effect.sync(() => {
        const expected = ['admin', 'audit', 'auth', 'health', 'jobs', 'search', 'storage', 'telemetry', 'transfer', 'users', 'webhooks', 'websocket'] as const;
        expect(Object.keys(GROUPS).sort((a, b) => a.localeCompare(b))).toEqual([...expected]);
    }));
