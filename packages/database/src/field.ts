/**
 * Canonical model-field metadata for repository SQL generation.
 * Maps camelCase model fields to snake_case database columns.
 */
/** biome-ignore-all assist/source/useSortedKeys: <registry readability> */

// --- [TYPES] -----------------------------------------------------------------

type FieldEntry = Readonly<{
    col:   string;
    field: string;
    gen?:  'stored' | 'uuidv7' | 'virtual';
    mark?: 'exp' | 'soft';
    sql:   string;
    wrap?: 'casefold';
}>;

// --- [CONSTANTS] -------------------------------------------------------------

const _SQL_CAST = {     INET: 'inet',              JSONB: 'jsonb',            UUID: 'uuid' } as const;
const _REGISTRY = {
    action:           { col: 'action',             field: 'action',           sql: 'TEXT'                          },
    agent:            { col: 'agent',              field: 'agent',            sql: 'TEXT'                          },
    appId:            { col: 'app_id',             field: 'appId',            sql: 'UUID'                          },
    attempts:         { col: 'attempts',           field: 'attempts',         sql: 'INTEGER'                       },
    backedUp:         { col: 'backed_up',          field: 'backedUp',         sql: 'BOOLEAN'                       },
    backups:          { col: 'backups',            field: 'backups',          sql: 'TEXT[]'                        },
    channel:          { col: 'channel',            field: 'channel',          sql: 'TEXT'                          },
    completedAt:      { col: 'completed_at',       field: 'completedAt',      sql: 'TIMESTAMPTZ'                   },
    content:          { col: 'content',            field: 'content',          sql: 'TEXT'                          },
    contentText:      { col: 'content_text',       field: 'contentText',      sql: 'TEXT'                          },
    contextAgent:     { col: 'context_agent',      field: 'contextAgent',     sql: 'TEXT'                          },
    contextIp:        { col: 'context_ip',         field: 'contextIp',        sql: 'INET'                          },
    contextRequestId: { col: 'context_request_id', field: 'contextRequestId', sql: 'UUID'                          },
    contextUserId:    { col: 'context_user_id',    field: 'contextUserId',    sql: 'UUID'                          },
    correlation:      { col: 'correlation',        field: 'correlation',      sql: 'JSONB'                         },
    counter:          { col: 'counter',            field: 'counter',          sql: 'INTEGER'                       },
    createdAt:        { col: 'created_at',         field: 'createdAt',        gen: 'stored',    sql: 'TIMESTAMPTZ' },
    credentialId:     { col: 'credential_id',      field: 'credentialId',     sql: 'TEXT'                          },
    deletedAt:        { col: 'deleted_at',         field: 'deletedAt',        mark: 'soft',     sql: 'TIMESTAMPTZ' },
    delivery:         { col: 'delivery',           field: 'delivery',         sql: 'JSONB'                         },
    delta:            { col: 'delta',              field: 'delta',            sql: 'JSONB'                         },
    deviceType:       { col: 'device_type',        field: 'deviceType',       sql: 'TEXT'                          },
    dimensions:       { col: 'dimensions',         field: 'dimensions',       sql: 'INTEGER'                       },
    displayText:      { col: 'display_text',       field: 'displayText',      sql: 'TEXT'                          },
    documentHash:     { col: 'document_hash',      field: 'documentHash',     gen: 'stored',    sql: 'TEXT'        },
    email:            { col: 'email',              field: 'email',            sql: 'TEXT',      wrap: 'casefold'   },
    embedding:        { col: 'embedding',          field: 'embedding',        sql: 'HALFVEC'                       },
    enabledAt:        { col: 'enabled_at',         field: 'enabledAt',        sql: 'TIMESTAMPTZ'                   },
    encrypted:        { col: 'encrypted',          field: 'encrypted',        sql: 'BYTEA'                         },
    entityId:         { col: 'entity_id',          field: 'entityId',         sql: 'UUID'                          },
    entityType:       { col: 'entity_type',        field: 'entityType',       sql: 'TEXT'                          },
    errorReason:      { col: 'error_reason',       field: 'errorReason',      sql: 'TEXT'                          },
    errors:           { col: 'errors',             field: 'errors',           sql: 'JSONB'                         },
    expiryAccess:     { col: 'expiry_access',      field: 'expiryAccess',     sql: 'TIMESTAMPTZ'                   },
    expiryRefresh:    { col: 'expiry_refresh',     field: 'expiryRefresh',    mark: 'exp',      sql: 'TIMESTAMPTZ' },
    expiresAt:        { col: 'expires_at',         field: 'expiresAt',        mark: 'exp',      sql: 'TIMESTAMPTZ' },
    externalId:       { col: 'external_id',        field: 'externalId',       sql: 'TEXT'                          },
    hash:             { col: 'hash',               field: 'hash',             sql: 'TEXT'                          },
    history:          { col: 'history',            field: 'history',          sql: 'JSONB'                         },
    id:               { col: 'id',                 field: 'id',               gen: 'uuidv7',    sql: 'UUID'        },
    ipAddress:        { col: 'ip_address',         field: 'ipAddress',        sql: 'INET'                          },
    jobId:            { col: 'job_id',             field: 'jobId',            sql: 'TEXT'                          },
    key:              { col: 'key',                field: 'key',              sql: 'TEXT'                          },
    value:            { col: 'value',              field: 'value',            sql: 'TEXT'                          },
    lastUsedAt:       { col: 'last_used_at',       field: 'lastUsedAt',       sql: 'TIMESTAMPTZ'                   },
    metadata:         { col: 'metadata',           field: 'metadata',         sql: 'JSONB'                         },
    model:            { col: 'model',              field: 'model',            sql: 'TEXT'                          },
    name:             { col: 'name',               field: 'name',             sql: 'TEXT'                          },
    namespace:        { col: 'namespace',          field: 'namespace',        sql: 'TEXT',      wrap: 'casefold'   },
    provider:         { col: 'provider',           field: 'provider',         sql: 'TEXT'                          },
    operation:        { col: 'operation',          field: 'operation',        sql: 'TEXT'                          },
    output:           { col: 'output',             field: 'output',           sql: 'JSONB'                         },
    payload:          { col: 'payload',            field: 'payload',          sql: 'JSONB'                         },
    preferences:      { col: 'preferences',        field: 'preferences',      sql: 'JSONB'                         },
    prefix:           { col: 'prefix',             field: 'prefix',           gen: 'virtual',   sql: 'TEXT'        },
    priority:         { col: 'priority',           field: 'priority',         sql: 'TEXT'                          },
    publicKey:        { col: 'public_key',         field: 'publicKey',        sql: 'BYTEA'                         },
    recipient:        { col: 'recipient',          field: 'recipient',        sql: 'TEXT'                          },
    remaining:        { col: 'remaining',          field: 'remaining',        gen: 'virtual',   sql: 'INTEGER'     },
    replayedAt:       { col: 'replayed_at',        field: 'replayedAt',       mark: 'soft',     sql: 'TIMESTAMPTZ' },
    requestId:        { col: 'request_id',         field: 'requestId',        sql: 'UUID'                          },
    resource:         { col: 'resource',           field: 'resource',         sql: 'TEXT'                          },
    retryCurrent:     { col: 'retry_current',      field: 'retryCurrent',     sql: 'INTEGER'                       },
    retryMax:         { col: 'retry_max',          field: 'retryMax',         sql: 'INTEGER'                       },
    role:             { col: 'role',               field: 'role',             sql: 'TEXT'                          },
    scheduledAt:      { col: 'scheduled_at',       field: 'scheduledAt',      sql: 'TIMESTAMPTZ'                   },
    scopeId:          { col: 'scope_id',           field: 'scopeId',          sql: 'UUID'                          },
    searchVector:     { col: 'search_vector',      field: 'searchVector',     gen: 'stored',    sql: 'TSVECTOR'    },
    sessionId:        { col: 'session_id',         field: 'sessionId',        sql: 'UUID'                          },
    settings:         { col: 'settings',           field: 'settings',         sql: 'JSONB'                         },
    size:             { col: 'size',               field: 'size',             gen: 'stored',    sql: 'INTEGER'     },
    source:           { col: 'source',             field: 'source',           sql: 'TEXT'                          },
    sourceId:         { col: 'source_id',          field: 'sourceId',         sql: 'TEXT'                          },
    status:           { col: 'status',             field: 'status',           sql: 'TEXT'                          },
    storageRef:       { col: 'storage_ref',        field: 'storageRef',       sql: 'TEXT'                          },
    targetId:         { col: 'target_id',          field: 'targetId',         sql: 'UUID'                          },
    targetType:       { col: 'target_type',        field: 'targetType',       sql: 'TEXT'                          },
    template:         { col: 'template',           field: 'template',         sql: 'TEXT'                          },
    tokenAccess:      { col: 'token_access',       field: 'tokenAccess',      sql: 'TEXT'                          },
    tokenPayload:     { col: 'token_payload',      field: 'tokenPayload',     sql: 'BYTEA'                         },
    tokenRefresh:     { col: 'token_refresh',      field: 'tokenRefresh',     sql: 'TEXT'                          },
    transports:       { col: 'transports',         field: 'transports',       sql: 'TEXT[]'                        },
    type:             { col: 'type',               field: 'type',             sql: 'TEXT'                          },
    updatedAt:        { col: 'updated_at',         field: 'updatedAt',        sql: 'TIMESTAMPTZ'                   },
    userId:           { col: 'user_id',            field: 'userId',           sql: 'UUID'                          },
    verifiedAt:       { col: 'verified_at',        field: 'verifiedAt',       sql: 'TIMESTAMPTZ'                   },
} as const satisfies Record<string, FieldEntry>;

// --- [FUNCTIONS] -------------------------------------------------------------

const _colToEntry: Record<string, FieldEntry> = Object.fromEntries(
    Object.values(_REGISTRY).map((e) => [e.col, e]),
);
const _resolve = (fieldOrCol: string): FieldEntry | undefined => _REGISTRY[fieldOrCol as keyof typeof _REGISTRY] ?? _colToEntry[fieldOrCol];

// --- [OBJECT] ----------------------------------------------------------------

const Field = {
    resolve:  _resolve,
    sqlCast:  _SQL_CAST,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Field };
