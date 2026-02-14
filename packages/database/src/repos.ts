/**
 * Expose batched repositories via factory pattern.
 * UUIDv7 ordering, casefold comparisons, purge/revoke DB functions.
 */
import { SqlClient } from '@effect/sql';
import { Clock, Effect, Option, Record as R, Schema as S } from 'effect';
import { repo, routine, Update, type Pred } from './factory.ts';
import { ApiKey, App, AppSettingsDefaults, Asset, AuditLog, type AuditOperationSchema, Job, JobDlq, KvStore, MfaSecret, Notification, OauthAccount, Permission, Session, User, WebauthnCredential, AppSettingsSchema } from './models.ts';
import { SearchRepo } from './search.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _LIMITS = { defaultAuditWindow: 60, defaultPage: 100 } as const;

// --- [REPOSITORIES] ----------------------------------------------------------

const makeUserRepo = Effect.gen(function* () {
    const repository = yield* repo(User, 'users', { resolve: { byEmail: 'email' }, scoped: 'appId' });
    return { ...repository,
        byRole: (role: string) => repository.find([{ field: 'role', value: role }]),
        setPreferences: (id: string, preferences: S.Schema.Type<typeof User.fields.preferences>) => repository.set(id, { preferences }),
    };
});
const makePermissionRepo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repository = yield* repo(Permission, 'permissions', {
        conflict: { keys: ['appId', 'role', 'resource', 'action'], only: ['deletedAt'] },
        scoped: 'appId',
    });
    return { ...repository,
        byRole: (role: string) => repository.find([{ field: 'role', value: role }]),
        grant: (payload: { appId: string; role: S.Schema.Type<typeof Permission.fields.role>; resource: string; action: string }) =>
            repository.upsert({
                action: payload.action,
                appId: payload.appId,
                deletedAt: Option.none(),
                resource: payload.resource,
                role: payload.role,
                updatedAt: undefined,
            }),
        lookupImmv: (appId: string, role: string, resource: string, action: string) => sql`SELECT app_id FROM permission_lookups WHERE app_id = ${appId} AND role = ${role} AND resource = ${resource} AND action = ${action}`.pipe(Effect.map((rows) => rows.length > 0)),
        revoke: (role: string, resource: string, action: string) =>
            repository.drop([
                { field: 'role', value: role },
                { field: 'resource', value: resource },
                { field: 'action', value: action },
            ]),
    };
});
const makeAppRepo = Effect.gen(function* () {
    const repository = yield* repo(App, 'apps', { resolve: { byNamespace: 'namespace' } });
    const _decodeSettings = (rawValue: unknown) => S.decodeUnknown(AppSettingsSchema)(rawValue, { errors: 'all', onExcessProperty: 'ignore' });
    return { ...repository,
        readSettings: (id: string, lock: false | 'update' = false) => repository.one([{ field: 'id', value: id }], lock).pipe(
            Effect.flatMap(Option.match({
                onNone: () => Effect.succeed(Option.none()),
                onSome: (app) => _decodeSettings(Option.getOrElse(app.settings, () => AppSettingsDefaults)).pipe(Effect.map((settings) => Option.some({ app, settings }))),
            })),
        ),
        updateSettings: (id: string, settings: S.Schema.Type<typeof AppSettingsSchema>) => repository.set(id, { settings }),
    };
});
const makeSessionRepo = Effect.gen(function* () {
    const repository = yield* repo(Session, 'sessions', {
        functions: { revoke_sessions_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }], params: S.Struct({ appId: S.UUID, ip: S.String }) } },
        purge: 'purge_sessions',
        resolve: {
            byAccessToken:  { field: 'token_access', through: { table: 'session_tokens', target: 'session_id' } },
            byRefreshToken: { field: 'token_refresh', through: { table: 'session_tokens', target: 'session_id' } },
        },
        scoped: 'appId',
    });
    return { ...repository,
        byRefreshTokenForUpdate: (hash: string) => repository.by('byRefreshToken', hash, 'update'),
        byUser: (userId: string) => repository.find([{ field: 'user_id', value: userId }]),
        softDeleteByIp: (appId: string, ip: string) => repository.fn<number>('revoke_sessions_by_ip', { appId, ip }),
        touch: (id: string) => repository.set(id, { updated_at: Update.now }),
        verify: (id: string) => repository.set(id, { verified_at: Update.now }, undefined, { field: 'verified_at', op: 'null' }),
    };
});
const makeApiKeyRepo = Effect.gen(function* () {
    const repository = yield* repo(ApiKey, 'api_keys', { purge: 'purge_api_keys', resolve: { byHash: 'hash', byUser: { field: 'userId', many: true } } });
    return { ...repository,
        touch: (id: string) => repository.set(id, { last_used_at: Update.now }),
    };
});
const makeOauthAccountRepo = Effect.gen(function* () {
    const repository = yield* repo(OauthAccount, 'oauth_accounts', {
        conflict: { keys: ['provider', 'externalId'], only: ['tokenPayload'] },
        purge: 'purge_oauth_accounts', resolve: { byExternal: ['provider', 'externalId'], byUser: { field: 'userId', many: true } },
    });
    return { ...repository,
        byExternal: (provider: string, externalId: string) => repository.by('byExternal', { externalId, provider }),
    };
});
const makeAssetRepo = Effect.gen(function* () {
    const repository = yield* repo(Asset, 'assets', { purge: 'purge_assets', scoped: 'appId' });
    return { ...repository,
        byFilter: (userId: string, { after, before, ids, types }: { after?: Date; before?: Date; ids?: string[]; types?: string[] } = {}) => repository.find(repository.preds({ after, before, id: ids, type: types, user_id: userId })),
        byHash: (hash: string) => repository.one([{ field: 'hash', value: hash }]),
        byType: (type: string) => repository.find([{ field: 'type', value: type }]),
        byUser: (userId: string) => repository.find([{ field: 'user_id', value: userId }]),
        byUserKeyset: (userId: string, limit: number, cursor?: string) => repository.page([{ field: 'user_id', value: userId }], { cursor, limit }),
        findStaleForPurge: (olderThanDays: number) => Clock.currentTimeMillis.pipe(
            Effect.andThen((now) => repository.find([
                { field: 'deleted_at',  op: 'notNull' },
                { field: 'deleted_at',  op: 'lt', value: new Date(now - olderThanDays * 24 * 60 * 60 * 1000) },
                { field: 'storage_ref', op: 'notNull' },
            ])),
        ),
        insertMany: (items: readonly S.Schema.Type<typeof Asset.insert>[]) => repository.put([...items]),
    };
});
const makeAuditRepo = Effect.gen(function* () {
    const repository = yield* repo(AuditLog, 'audit_logs', {
        functions: { count_audit_by_ip: { args: [{ cast: 'uuid', field: 'appId' }, { cast: 'inet', field: 'ip' }, 'windowMinutes'], params: S.Struct({ appId: S.UUID, ip: S.String, windowMinutes: S.Number }) } },
        scoped: 'appId',
    });
    return { ...repository,
        byIp: (ip: string, limit: number, cursor?: string) => repository.page([{ field: 'context_ip', value: ip }], { cursor, limit }),
        bySubject: (type: string, id: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: S.Schema.Type<typeof AuditOperationSchema> } = {}) => repository.page([{ field: 'target_type', value: type }, { field: 'target_id', value: id }, ...repository.preds({ after, before, operation })], { cursor, limit }),
        byUser: (userId: string, limit: number, cursor?: string, { after, before, operation }: { after?: Date; before?: Date; operation?: S.Schema.Type<typeof AuditOperationSchema> } = {}) => repository.page(repository.preds({ after, before, operation, user_id: userId }), { cursor, limit }),
        countByIp: (appId: string, ip: string, windowMinutes = _LIMITS.defaultAuditWindow) => repository.fn<number>('count_audit_by_ip', { appId, ip, windowMinutes }),
        log: repository.insert,
    };
});
const makeMfaSecretRepo = Effect.gen(function* () {
    const repository = yield* repo(MfaSecret, 'mfa_secrets', {
        conflict: { keys: ['userId'], only: ['backups', 'enabledAt', 'encrypted'] },
        purge: 'purge_mfa_secrets', resolve: { byUser: 'userId' },
    });
    return { ...repository,
        softDelete: (userId: string) => repository.drop([{ field: 'user_id', value: userId }]),
    };
});
const makeWebauthnCredentialRepo = Effect.gen(function* () {
    const repository = yield* repo(WebauthnCredential, 'webauthn_credentials', { resolve: { byCredentialId: 'credentialId', byUser: { field: 'userId', many: true } } });
    return { ...repository,
        touch: (id: string) => repository.set(id, { last_used_at: Update.now }),
        updateCounter: (id: string, counter: number) => repository.set(id, { counter, last_used_at: Update.now }),
    };
});
const makeJobRepo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repository = yield* repo(Job, 'jobs', { pk: { column: 'job_id' }, scoped: 'appId' });
    return { ...repository,
        byDateRange: (after: Date, before: Date, options?: { limit?: number; cursor?: string }) => repository.page(repository.preds({ after, before }), { cursor: options?.cursor, limit: options?.limit ?? _LIMITS.defaultPage }),
        byStatus: (status: string, options?: { after?: Date; before?: Date; limit?: number; cursor?: string }) => repository.page([{ field: 'status', value: status }, ...repository.preds({ after: options?.after, before: options?.before })], { cursor: options?.cursor, limit: options?.limit ?? _LIMITS.defaultPage }),
        countByStatuses: (...statuses: readonly string[]) => repository.count([{ field: 'status', op: 'in', values: [...statuses] }]),
        countByStatusesImmv: (...statuses: readonly string[]) => sql`SELECT status, cnt FROM job_status_counts WHERE status IN ${sql.in([...statuses])}`.pipe(Effect.map((rows) => Object.fromEntries((rows as readonly { status: string; cnt: number }[]).map((row) => [row.status, row.cnt])) as Record<string, number>)),
        isDuplicate: (dedupeKey: string) => repository.exists([{ raw: sql`correlation->>'dedupe' = ${dedupeKey}` }, { field: 'status', op: 'in', values: ['queued', 'processing'] }]),
    };
});
const makeJobDlqRepo = Effect.gen(function* () {
    const repository = yield* repo(JobDlq, 'job_dlq', { purge: 'purge_job_dlq', resolve: { bySource: 'sourceId' }, scoped: 'appId' });
    const _byType = (type?: string): readonly Pred[] =>
        type === undefined ? [] : [{ field: 'type', op: type.includes('*') ? 'like' as const : 'eq' as const, value: type.replaceAll('*', '%') }];
    return { ...repository,
        byErrorReason: (errorReason: string, options?: { limit?: number; cursor?: string }) => repository.page([{ field: 'error_reason', value: errorReason }], { cursor: options?.cursor, limit: options?.limit ?? _LIMITS.defaultPage }),
        byRequest: (requestId: string) => repository.find([{ field: 'context_request_id', value: requestId }]),
        countPending: (type?: string) => repository.count(_byType(type)),
        listPending: (options?: { type?: string; limit?: number; cursor?: string }) => repository.page(_byType(options?.type), { cursor: options?.cursor, limit: options?.limit ?? _LIMITS.defaultPage }),
        markReplayed: (id: string) => repository.drop(id),
        unmarkReplayed: (id: string) => repository.lift(id),
    };
});
const makeNotificationRepo = Effect.gen(function* () {
    const repository = yield* repo(Notification, 'notifications', { scoped: 'appId' });
    return { ...repository,
        transition: (id: string, updates: { status: S.Schema.Type<typeof Notification.fields.status>; delivery?: S.Schema.Type<typeof Notification.fields.delivery>; correlation?: S.Schema.Type<typeof Notification.fields.correlation>; retryCurrent?: S.Schema.Type<typeof Notification.fields.retryCurrent>; retryMax?: S.Schema.Type<typeof Notification.fields.retryMax> }, whenStatus?: S.Schema.Type<typeof Notification.fields.status>) =>
            repository.set(
                id,
                R.filter(
                    { correlation: updates.correlation, delivery: updates.delivery, retryCurrent: updates.retryCurrent, retryMax: updates.retryMax, status: updates.status } as Record<string, unknown>,
                    (value) => value !== undefined,
                ),
                undefined,
                Option.fromNullable(whenStatus).pipe(
                    Option.map((status) => ({ field: 'status', value: status })),
                    Option.getOrUndefined,
                ),
            ),
    };
});
const makeKvStoreRepo = Effect.gen(function* () {
    const repository = yield* repo(KvStore, 'kv_store', {
        conflict: { keys: ['key'], only: ['value', 'expiresAt'] },
        functions: { delete_kv_by_prefix: { args: ['prefix'], params: S.Struct({ prefix: S.String }) } },
        purge: 'purge_kv_store', resolve: { byKey: 'key' },
    });
    return { ...repository,
        deleteByPrefix: (prefix: string) => repository.fn<number>('delete_kv_by_prefix', { prefix }),
        getJson: <A, I, R>(key: string, schema: S.Schema<A, I, R>) => repository.by('byKey', key).pipe(Effect.flatMap(repository.json.decode('value', schema))),
        setJson: <A, I, R>(key: string, jsonValue: A, schema: S.Schema<A, I, R>, expiresAt?: Date) => repository.json.encode(schema)(jsonValue).pipe(Effect.flatMap((encoded) => repository.upsert({ expiresAt, key, value: encoded }))),
    };
});
const makeSystemRepo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const repository = yield* routine('database/system', {
        functions: {
            count_outbox: {},
            create_hypothetical_index: {
                args: ['statement'], mode: 'set',
                params: S.Struct({ statement: S.String }),
                schema: S.Struct({ indexname: S.String, indexrelid: S.Number }),
            },
            get_journal_entry: {
                args: ['primaryKey'], mode: 'set',
                params: S.Struct({ primaryKey: S.String }),
                schema: S.Struct({ payload: S.String }),
            },
            heap_force_freeze: {
                args: ['relation', 'block'],
                params: S.Struct({ block: S.Number, relation: S.String }),
            },
            list_journal_entries: {
                args: ['sinceSequenceId', 'sinceTimestamp', 'eventType', 'batchSize'],
                mode: 'set',
                params: S.Struct({
                    batchSize: S.Number,
                    eventType: S.NullOr(S.String),
                    sinceSequenceId: S.String,
                    sinceTimestamp: S.NullOr(S.Number),
                }),
                schema: S.Struct({ payload: S.String, primaryKey: S.String }),
            },
            list_partition_health: {
                args: ['parentTable'], mode: 'typed',
                params: S.Struct({ parentTable: S.String }),
                schema: S.Array(S.Unknown),
            },
            prewarm_relation: {
                args: ['relation', 'mode'],
                params: S.Struct({ mode: S.String, relation: S.String }),
            },
            purge_journal: {
                args: ['days'],
                params: S.Struct({ days: S.Number }),
            },
            purge_tenant: {
                args: ['appId'],
                params: S.Struct({ appId: S.UUID }),
            },
            reset_hypothetical_indexes: { mode: 'scalar', schema: S.Void },
            reset_wait_sampling_profile: { mode: 'scalar', schema: S.Boolean },
            run_partman_maintenance: { mode: 'scalar', schema: S.Boolean },
            start_squeeze_worker: { mode: 'scalar', schema: S.Boolean },
            stat: {
                args: ['name', 'limit', { cast: 'jsonb', field: 'extra' }],
                mode: 'typed',
                params: S.Struct({
                    extra: S.NullOr(S.String),
                    limit: S.Number,
                    name: S.String,
                }),
                schema: S.Array(S.Unknown),
            },
            stop_squeeze_worker: {
                args: ['pid'], mode: 'scalar',
                params: S.Struct({ pid: S.Number }),
                schema: S.Boolean,
            },
            sync_cron_jobs: { mode: 'typed', schema: S.Array(S.Unknown) },
        },
    });
    const _stat = <T = readonly unknown[]>(name: string, limit = _LIMITS.defaultPage, extra: Record<string, unknown> | null = null) =>
        repository.fn<T>('stat', { extra: extra ? JSON.stringify(extra) : null, limit, name });
    return {
        buffercacheSummary: () => _stat<readonly {
            buffersDirty: number; buffersPinned: number;
            buffersUnused: number; buffersUsed: number;
            usagecountAvg: number;
        }[]>('buffercache_summary'),
        buffercacheTop: (limit = _LIMITS.defaultPage) => _stat<readonly {
            buffers: number; pct: number;
            relkind: string; relname: string;
            size: string;
        }[]>('buffercache_top', limit),
        buffercacheUsage: () => _stat<readonly {
            buffers: number; dirty: number;
            pinned: number; usageCount: number;
        }[]>('buffercache_usage'),
        cacheRatio: () => _stat<readonly {
            backendType: string; cacheHitRatio: number; hits: number;
            ioContext: string; ioObject: string; reads: number; writes: number;
        }[]>('cache_ratio'),
        connectionStats: (limit = _LIMITS.defaultPage) => _stat<readonly {
            clientAddr: string | null; cnt: number;
            datname: string | null; newestQuery: string | null;
            oldestBackend: string | null; state: string | null;
            usename: string | null;
        }[]>('connection_stats', limit),
        createHypotheticalIndex: (statement: string) => repository.fn<readonly {
            indexrelid: number; indexname: string;
        }[]>('create_hypothetical_index', { statement }),
        cronFailures: (hours = 24) => _stat<readonly {
            endTime: string | null; jobname: string;
            returnMessage: string | null; runid: number;
            startTime: string | null; status: string;
        }[]>('cron_failures', _LIMITS.defaultPage, { hours }),
        cronHistory: (limit = _LIMITS.defaultPage, jobName: string | null = null) =>
            _stat<readonly {
                command: string; database: string;
                durationSeconds: number | null; endTime: string | null; jobname: string;
                jobPid: number;
                returnMessage: string | null; runid: number;
                startTime: string | null; status: string;
                username: string;
            }[]>('cron_history', limit, jobName ? { job_name: jobName } : null),
        cronJobs: () => _stat<readonly {
            active: boolean; command: string; database: string;
            jobid: number; jobname: string | null;
            nodename: string; nodeport: number;
            schedule: string; username: string;
        }[]>('cron_jobs'),
        deadTuples: (limit = _LIMITS.defaultPage) => _stat<readonly {
            analyzeCount: number; autoanalyzeCount: number;
            autovacuumCount: number; deadPct: number;
            lastAnalyze: string | null; lastAutoanalyze: string | null;
            lastAutovacuum: string | null; lastVacuum: string | null;
            nDeadTup: number; nLiveTup: number;
            relname: string; schemaname: string;
            vacuumCount: number;
        }[]>('dead_tuples', limit),
        heapForceFreeze: (relation: string, block = 0) =>
            repository.fn<void>('heap_force_freeze', { block, relation }),
        hypotheticalIndexes: () => _stat<readonly {
            amname: string; indexname: string;
            indexrelid: number; nspname: string;
            relname: string;
        }[]>('hypothetical_indexes'),
        immvJobStatusCounts: () =>
            sql<{ appId: string; status: string; cnt: number }>`
                SELECT app_id, status, cnt
                FROM job_status_counts ORDER BY app_id, status`,
        immvPermissionLookups: () =>
            sql<{ appId: string; role: string; resource: string; action: string }>`
                SELECT app_id, role, resource, action
                FROM permission_lookups
                ORDER BY app_id, role, resource, action`,
        indexAdvisor: (minFilter = 1000, minSelectivity = 30) =>
            _stat<readonly {
                accessMethod: string | null;
                indexDdl: string; queryids: unknown;
            }[]>('index_advisor', _LIMITS.defaultPage, {
                min_filter: minFilter, min_selectivity: minSelectivity,
            }),
        indexBloat: (limit = _LIMITS.defaultPage) => _stat<readonly {
            idxScan: number; idxTupFetch: number;
            idxTupRead: number; indexBytes: number; indexname: string;
            indexSize: string;
            schemaname: string; tablename: string;
        }[]>('index_bloat', limit),
        indexUsage: (limit = _LIMITS.defaultPage) => _stat<readonly {
            idxScan: number; idxTupFetch: number;
            idxTupRead: number; indexBytes: number; indexrelname: string;
            indexSize: string;
            relname: string; schemaname: string;
        }[]>('index_usage', limit),
        ioConfig: () => _stat<readonly { name: string; setting: string }[]>('io_config'),
        ioDetail: () => _stat<readonly {
            backendType: string; evictions: number; extendBytes: number; extends: number;
            extendTime: number;
            fsyncs: number; fsyncTime: number; hits: number; ioContext: string;
            ioObject: string; readBytes: number;
            reads: number; readTime: number; reuses: number; statsReset: string | null;
            writeBytes: number;
            writebacks: number; writebackTime: number; writes: number; writeTime: number;
        }[]>('io_detail'),
        journalEntry: (primaryKey: string) =>
            repository.fn<readonly { payload: string }[]>(
                'get_journal_entry', { primaryKey },
            ).pipe(Effect.map((rows) => Option.fromNullable(rows[0]))),
        journalPurge: (days: number) => repository.fn<number>('purge_journal', { days }),
        journalReplay: (input: {
            batchSize: number; eventType?: string;
            sinceSequenceId: string; sinceTimestamp?: number;
        }) => repository.fn<readonly { payload: string; primaryKey: string }[]>(
            'list_journal_entries', {
                batchSize: input.batchSize,
                eventType: Option.getOrNull(Option.fromNullable(input.eventType)),
                sinceSequenceId: input.sinceSequenceId,
                sinceTimestamp: Option.getOrNull(
                    Option.fromNullable(input.sinceTimestamp),
                ),
            },
        ),
        kcache: (limit = _LIMITS.defaultPage) => _stat<readonly {
            calls: number; datname: string;
            execReads: number; execSystemTime: number;
            execUserTime: number; execWrites: number;
            meanExecTime: number; planReads: number;
            planSystemTime: number; planUserTime: number;
            planWrites: number; query: string;
            queryid: number; readsPerCall: number | null;
            rolname: string; statsSince: string | null;
            top: boolean; totalExecTime: number;
            writesPerCall: number | null;
        }[]>('kcache', limit),
        lockContention: (limit = _LIMITS.defaultPage) => _stat<readonly {
            blockedDuration: string; blockedPid: number;
            blockedQuery: string; blockedUser: string;
            blockingPid: number; blockingQuery: string;
            blockingState: string; blockingUser: string;
            waitEvent: string | null; waitEventType: string | null;
        }[]>('lock_contention', limit),
        longRunningQueries: (limit = _LIMITS.defaultPage, minSeconds = 5) =>
            _stat<readonly {
                datname: string; duration: string;
                durationSeconds: number; pid: number;
                query: string; queryStart: string;
                state: string; stateChange: string;
                usename: string; waitEvent: string | null;
                waitEventType: string | null;
            }[]>('long_running_queries', limit, { min_seconds: minSeconds }),
        outboxCount: () => repository.fn<number>('count_outbox', {}),
        partitionHealth: (parentTable = 'public.sessions') =>
            repository.fn<readonly {
                bound: string | null; isLeaf: boolean;
                level: number; partition: string;
            }[]>('list_partition_health', { parentTable }),
        partmanConfig: () => _stat<readonly {
            control: string; infiniteTimePartitions: boolean;
            parentTable: string; partitionInterval: string;
            premake: number; retention: string | null;
        }[]>('partman_config'),
        prewarmRelation: (relation: string, mode = 'buffer') =>
            repository.fn<number>('prewarm_relation', { mode, relation }),
        qualstats: (limit = _LIMITS.defaultPage) => _stat<readonly {
            constvalues: readonly string[] | null; dbid: number;
            exampleQuery: string | null; executionCount: number;
            filterRatioPct: number; nbfiltered: number;
            occurences: number; qualnodeid: number;
            quals: unknown; queryid: number;
            uniquequalnodeid: number; userid: number;
        }[]>('qualstats', limit),
        replicationLag: (limit = _LIMITS.defaultPage) => _stat<readonly {
            applicationName: string; clientAddr: string | null;
            flushLag: string | null; flushLsn: string | null;
            replayLag: string | null; replayLagBytes: number | null;
            replayLsn: string | null; sentLsn: string | null;
            state: string; syncPriority: number;
            syncState: string; writeLag: string | null;
            writeLsn: string | null;
        }[]>('replication_lag', limit),
        resetHypotheticalIndexes: () =>
            repository.fn<void>('reset_hypothetical_indexes', {}),
        resetWaitSampling: () =>
            repository.fn<boolean>('reset_wait_sampling_profile', {}),
        runPartmanMaintenance: () =>
            repository.fn<boolean>('run_partman_maintenance', {}),
        seqScanHeavy: (limit = _LIMITS.defaultPage) => _stat<readonly {
            idxScan: number; nLiveTup: number;
            relname: string; schemaname: string;
            seqPct: number; seqScan: number;
            seqTupRead: number; totalBytes: number;
        }[]>('seq_scan_heavy', limit),
        squeezeStartWorker: () => repository.fn<boolean>('start_squeeze_worker', {}),
        squeezeStatus: () => Effect.all({
            tables: _stat('squeeze_tables'),
            workers: _stat('squeeze_workers'),
        }),
        squeezeStopWorker: (pid: number) =>
            repository.fn<boolean>('stop_squeeze_worker', { pid }),
        statements: (limit = _LIMITS.defaultPage) => _stat<readonly {
            blkReadTime: number; blkWriteTime: number;
            calls: number; dbid: number; dealloc: number;
            meanExecTime: number; meanPlanTime: number;
            parallelWorkersLaunched: number; parallelWorkersToLaunch: number;
            plans: number; query: string; queryid: number;
            rows: number; sharedBlksDirtied: number;
            sharedBlksHit: number; sharedBlksRead: number;
            sharedBlksWritten: number; statsReset: string | null;
            tempBlksRead: number; tempBlksWritten: number;
            toplevel: boolean; totalExecTime: number;
            totalPlanTime: number; userid: number;
            walBuffersFull: number; walBytes: number;
            walFpi: number; walRecords: number;
        }[]>('statements', limit),
        syncCronJobs: () => repository.fn<readonly {
            error?: string; name: string;
            schedule: string; status: 'created' | 'error' | 'unchanged' | 'updated';
        }[]>('sync_cron_jobs', {}),
        tableBloat: (limit = _LIMITS.defaultPage) => _stat<readonly {
            indexBytes: number; overheadBytes: number;
            schemaname: string; tableBytes: number; tablename: string;
            tableSize: string;
            totalBytes: number; totalSize: string;
        }[]>('table_bloat', limit),
        tableSizes: (limit = _LIMITS.defaultPage) => _stat<readonly {
            idxScan: number; idxTupFetch: number;
            indexBytes: number; nDeadTup: number;
            nLiveTup: number; relname: string;
            schemaname: string; seqScan: number;
            seqTupRead: number; tableBytes: number;
            totalBytes: number; totalSize: string;
        }[]>('table_sizes', limit),
        tenantPurge: (appId: string) => repository.fn<number>('purge_tenant', { appId }),
        unusedIndexes: (limit = _LIMITS.defaultPage) => _stat<readonly {
            idxScan: number; indexBytes: number; indexrelname: string;
            indexSize: string;
            relname: string; schemaname: string;
        }[]>('unused_indexes', limit),
        visibility: (limit = _LIMITS.defaultPage) => _stat<readonly {
            allFrozen: number; allVisible: number; relkind: string;
            relname: string;
            relSize: number;
        }[]>('visibility', limit),
        waitSampling: (limit = _LIMITS.defaultPage) => _stat<readonly {
            event: string; eventType: string; totalCount: number;
        }[]>('wait_sampling', limit),
        waitSamplingCurrent: (limit = _LIMITS.defaultPage) =>
            _stat<readonly {
                event: string; eventType: string;
                pid: number; queryid: number | null;
            }[]>('wait_sampling_current', limit),
        waitSamplingHistory: (
            limit = _LIMITS.defaultPage,
            sinceSeconds = _LIMITS.defaultAuditWindow,
        ) => _stat<readonly {
            event: string; eventType: string;
            pid: number; queryid: number | null;
            sampleTs: string;
        }[]>('wait_sampling_history', limit, { since_seconds: sinceSeconds }),
        walInspect: (limit = _LIMITS.defaultPage) => _stat<readonly {
            blockRef: string | null; description: string | null;
            endLsn: string; fpiLength: number;
            mainDataLength: number; recordLength: number;
            recordType: string | null; resourceManager: string;
            startLsn: string;
        }[]>('wal_inspect', limit),
    };
});

// --- [SERVICES] --------------------------------------------------------------

class DatabaseService extends Effect.Service<DatabaseService>()('database/DatabaseService', {
    dependencies: [SearchRepo.Default],
    effect: Effect.gen(function* () {
        const [searchRepo, sqlClient] = yield* Effect.all([SearchRepo, SqlClient.SqlClient]);
        const [users, permissions, apps, sessions, apiKeys, oauthAccounts, assets, audit, mfaSecrets, webauthnCredentials, jobs, jobDlq, notifications, kvStore, system] = yield* Effect.all([
            makeUserRepo, makePermissionRepo, makeAppRepo, makeSessionRepo, makeApiKeyRepo,
            makeOauthAccountRepo, makeAssetRepo, makeAuditRepo, makeMfaSecretRepo, makeWebauthnCredentialRepo, makeJobRepo, makeJobDlqRepo, makeNotificationRepo, makeKvStoreRepo, makeSystemRepo,
        ]);
        const monitoring = {
            cacheRatio: Effect.fn('db.cacheRatio')(system.cacheRatio),
            immvJobStatusCounts: Effect.fn('db.immvJobStatusCounts')(system.immvJobStatusCounts),
            immvPermissionLookups: Effect.fn('db.immvPermissionLookups')(system.immvPermissionLookups),
            ioConfig: Effect.fn('db.ioConfig')(system.ioConfig),
            ioDetail: Effect.fn('db.ioDetail')(system.ioDetail),
        } as const;
        return {
            apiKeys, apps, assets, audit,
            buffercacheSummary: Effect.fn('db.buffercacheSummary')(
                () => system.buffercacheSummary()),
            buffercacheTop: Effect.fn('db.buffercacheTop')(
                (limit = _LIMITS.defaultPage) => system.buffercacheTop(limit)),
            buffercacheUsage: Effect.fn('db.buffercacheUsage')(
                () => system.buffercacheUsage()),
            connectionStats: Effect.fn('db.connectionStats')(
                (limit = _LIMITS.defaultPage) => system.connectionStats(limit)),
            createHypotheticalIndex: Effect.fn('db.createHypotheticalIndex')(
                (statement: string) => system.createHypotheticalIndex(statement)),
            cronFailures: Effect.fn('db.cronFailures')(
                (hours = 24) => system.cronFailures(hours)),
            cronHistory: Effect.fn('db.cronHistory')(
                (limit = _LIMITS.defaultPage, jobName: string | null = null) =>
                    system.cronHistory(limit, jobName)),
            cronJobs: Effect.fn('db.cronJobs')(() => system.cronJobs()),
            deadTuples: Effect.fn('db.deadTuples')(
                (limit = _LIMITS.defaultPage) => system.deadTuples(limit)),
            heapForceFreeze: Effect.fn('db.heapForceFreeze')(
                (relation: string, block = 0) =>
                    system.heapForceFreeze(relation, block)),
            hypotheticalIndexes: Effect.fn('db.hypotheticalIndexes')(
                () => system.hypotheticalIndexes()),
            indexAdvisor: Effect.fn('db.indexAdvisor')(
                (minFilter = 1000, minSelectivity = 30) =>
                    system.indexAdvisor(minFilter, minSelectivity)),
            indexBloat: Effect.fn('db.indexBloat')(
                (limit = _LIMITS.defaultPage) => system.indexBloat(limit)),
            indexUsage: Effect.fn('db.indexUsage')(
                (limit = _LIMITS.defaultPage) => system.indexUsage(limit)),
            jobDlq, jobs, journal: {
                entry: (primaryKey: string) => system.journalEntry(primaryKey),
                purge: (olderThanDays: number) => system.journalPurge(olderThanDays),
                replay: (input: {
                    batchSize: number; eventType?: string;
                    sinceSequenceId: string; sinceTimestamp?: number;
                }) => system.journalReplay(input),
            },
            kcache: Effect.fn('db.kcache')(
                (limit = _LIMITS.defaultPage) => system.kcache(limit)),
            kvStore,
            lockContention: Effect.fn('db.lockContention')(
                (limit = _LIMITS.defaultPage) => system.lockContention(limit)),
            longRunningQueries: Effect.fn('db.longRunningQueries')(
                (limit = _LIMITS.defaultPage, minSeconds = 5) =>
                    system.longRunningQueries(limit, minSeconds)),
            mfaSecrets,
            monitoring, notifications, oauthAccounts,
            outbox: { count: system.outboxCount() },
            partitionHealth: Effect.fn('db.partitionHealth')(
                (parentTable = 'public.sessions') =>
                    system.partitionHealth(parentTable)),
            partmanConfig: Effect.fn('db.partmanConfig')(
                () => system.partmanConfig()),
            permissions,
            prewarmRelation: Effect.fn('db.prewarmRelation')(
                (relation: string, mode = 'buffer') =>
                    system.prewarmRelation(relation, mode)),
            qualstats: Effect.fn('db.qualstats')(
                (limit = _LIMITS.defaultPage) => system.qualstats(limit)),
            replicationLag: Effect.fn('db.replicationLag')(
                (limit = _LIMITS.defaultPage) => system.replicationLag(limit)),
            resetHypotheticalIndexes: Effect.fn('db.resetHypotheticalIndexes')(
                () => system.resetHypotheticalIndexes()),
            resetWaitSampling: Effect.fn('db.resetWaitSampling')(
                () => system.resetWaitSampling()),
            runPartmanMaintenance: Effect.fn('db.runPartmanMaintenance')(
                () => system.runPartmanMaintenance()),
            search: searchRepo,
            seqScanHeavy: Effect.fn('db.seqScanHeavy')(
                (limit = _LIMITS.defaultPage) => system.seqScanHeavy(limit)),
            sessions,
            squeezeStartWorker: Effect.fn('db.squeezeStartWorker')(
                () => system.squeezeStartWorker()),
            squeezeStatus: Effect.fn('db.squeezeStatus')(
                () => system.squeezeStatus()),
            squeezeStopWorker: Effect.fn('db.squeezeStopWorker')(
                (pid: number) => system.squeezeStopWorker(pid)),
            statements: Effect.fn('db.statements')(
                (limit = _LIMITS.defaultPage) => system.statements(limit)),
            syncCronJobs: Effect.fn('db.syncCronJobs')(
                () => system.syncCronJobs()),
            system: { tenantPurge: (appId: string) => system.tenantPurge(appId) },
            tableBloat: Effect.fn('db.tableBloat')(
                (limit = _LIMITS.defaultPage) => system.tableBloat(limit)),
            tableSizes: Effect.fn('db.tableSizes')(
                (limit = _LIMITS.defaultPage) => system.tableSizes(limit)),
            unusedIndexes: Effect.fn('db.unusedIndexes')(
                (limit = _LIMITS.defaultPage) => system.unusedIndexes(limit)),
            users,
            visibility: Effect.fn('db.visibility')(
                (limit = _LIMITS.defaultPage) => system.visibility(limit)),
            waitSampling: Effect.fn('db.waitSampling')(
                (limit = _LIMITS.defaultPage) => system.waitSampling(limit)),
            waitSamplingCurrent: Effect.fn('db.waitSamplingCurrent')(
                (limit = _LIMITS.defaultPage) =>
                    system.waitSamplingCurrent(limit)),
            waitSamplingHistory: Effect.fn('db.waitSamplingHistory')(
                (limit = _LIMITS.defaultPage,
                    sinceSeconds = _LIMITS.defaultAuditWindow) =>
                    system.waitSamplingHistory(limit, sinceSeconds)),
            walInspect: Effect.fn('db.walInspect')(
                (limit = _LIMITS.defaultPage) => system.walInspect(limit)),
            webauthnCredentials,
            withTransaction: sqlClient.withTransaction,
        };
    }),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace DatabaseService {
    export type Type = typeof DatabaseService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { DatabaseService };
