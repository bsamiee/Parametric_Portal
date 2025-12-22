# [H1][BACKEND_INTEGRATION]
>**Dictum:** *Packages export mechanisms; apps define values. Anthropic client is mechanism, CAD prompts are values.*

---
## [1][STATUS]

| Component                | State             | Issue                                       |
| ------------------------ | ----------------- | ------------------------------------------- |
| `packages/database/`     | **DONE**          | —                                           |
| `packages/server/`       | **DONE**          | —                                           |
| `packages/ai/`           | **CREATE**        | Generic Anthropic client (mechanism)        |
| `apps/api/`              | **REFACTOR**      | Separate infrastructure from domain logic   |
| `apps/parametric_icons/` | **SECURITY RISK** | Exposes `VITE_ANTHROPIC_API_KEY` in browser |

---
## [2][ARCHITECTURE]

### [2.1][CURRENT_PROBLEM]

```
apps/api/src/anthropic.ts  ← WRONG: Mixes SDK wrapper + domain prompt
```

The current file tries to be both:
1. **Infrastructure** — Anthropic SDK wrapper, config, client instantiation
2. **Domain** — SVG generation with a specific system prompt

### [2.2][TARGET_ARCHITECTURE]

```
packages/ai/                              ← NEW: Generic Anthropic client (mechanism)
└── src/
    └── client.ts                         # AnthropicClient layer
                                          # - Config-based API key
                                          # - sendMessage(system, messages, options)
                                          # - Error mapping
                                          # - NO domain-specific prompts

apps/api/
└── src/
    ├── services/
    │   └── icon-generation.ts            ← DOMAIN: CAD-specific logic (values)
    │                                     # - 83-line system prompt
    │                                     # - buildUserMessage()
    │                                     # - parseVariantsResponse()
    │                                     # - sanitizeSvg()
    │                                     # - Uses AnthropicClient from packages/ai
    └── routes/
        └── icons.ts                      # Calls IconGenerationService
```

**Future apps** import `packages/ai/` and define their own prompts in `services/`.

### [2.3][FILE_OPERATIONS]

| Operation  | File                                       | Action                                     |
| ---------- | ------------------------------------------ | ------------------------------------------ |
| **CREATE** | `packages/ai/`                             | New package with generic `AnthropicClient` |
| **CREATE** | `apps/api/src/services/icon-generation.ts` | Port `generation.ts` domain logic          |
| **DELETE** | `apps/api/src/anthropic.ts`                | Remove mixed-concern file                  |
| **UPDATE** | `apps/api/src/routes/icons.ts`             | Import from `icon-generation.ts`           |
| **UPDATE** | `apps/api/src/main.ts`                     | Provide `AnthropicClientLive` layer        |

---
## [3][PACKAGES_AI]

### [3.1][STRUCTURE]

```
packages/ai/
├── src/
│   └── client.ts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### [3.2][CLIENT_IMPLEMENTATION]

```typescript
// packages/ai/src/client.ts
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { Config, Context, Effect, Layer, pipe } from 'effect';
import { InternalError } from '@parametric-portal/server/errors';

// --- [TYPES] -----------------------------------------------------------------

type SendOptions = {
  readonly maxTokens?: number;
  readonly model?: string;
  readonly prefill?: string;
  readonly signal?: AbortSignal;
};

type AnthropicClientInterface = {
  readonly send: (
    system: string,
    messages: ReadonlyArray<MessageParam>,
    options?: SendOptions,
  ) => Effect.Effect<string, InternalError>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
  defaults: {
    maxTokens: 4096,
    model: 'claude-sonnet-4-20250514',
  },
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

class AnthropicClient extends Context.Tag('AnthropicClient')<
  AnthropicClient,
  AnthropicClientInterface
>() {}

// --- [LAYER] -----------------------------------------------------------------

const AnthropicClientLive = Layer.effect(
  AnthropicClient,
  Effect.gen(function* () {
    const apiKey = yield* Config.redacted('ANTHROPIC_API_KEY');
    const client = new Anthropic({ apiKey: String(apiKey) });

    return AnthropicClient.of({
      send: (system, messages, options = {}) =>
        pipe(
          Effect.tryPromise({
            catch: (e) =>
              e instanceof Error && e.name === 'AbortError'
                ? new InternalError({ cause: 'Request cancelled' })
                : new InternalError({ cause: `Anthropic API: ${String(e)}` }),
            try: () =>
              client.messages.create(
                {
                  max_tokens: options.maxTokens ?? B.defaults.maxTokens,
                  messages: [
                    ...messages,
                    ...(options.prefill ? [{ content: options.prefill, role: 'assistant' as const }] : []),
                  ],
                  model: options.model ?? B.defaults.model,
                  system,
                },
                { signal: options.signal },
              ),
          }),
          Effect.flatMap((response) => {
            const content = response.content[0];
            return content?.type === 'text'
              ? Effect.succeed(options.prefill ? options.prefill + content.text : content.text)
              : Effect.fail(new InternalError({ cause: 'No text in response' }));
          }),
        ),
    });
  }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AnthropicClient, AnthropicClientLive, B as AI_TUNING };
```

### [3.3][PACKAGE_JSON]

```json
{
  "name": "@parametric-portal/ai",
  "type": "module",
  "exports": {
    "./client": "./src/client.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "catalog:",
    "@parametric-portal/server": "workspace:*",
    "effect": "catalog:"
  }
}
```

---
## [4][DOMAIN_SERVICE]

### [4.1][ICON_GENERATION_SERVICE]

Port from `apps/parametric_icons/src/generation.ts`:

```typescript
// apps/api/src/services/icon-generation.ts
import { AnthropicClient } from '@parametric-portal/ai/client';
import { InternalError } from '@parametric-portal/server/errors';
import { Effect, pipe, Schema as S } from 'effect';
// DOMPurify for server-side: use jsdom or isomorphic-dompurify
import DOMPurify from 'isomorphic-dompurify';

// --- [TYPES] -----------------------------------------------------------------

type ColorMode = 'dark' | 'light';
type Intent = 'create' | 'refine';

type GenerateRequest = {
  readonly attachments?: ReadonlyArray<{ id: string; name: string; svg: string }>;
  readonly colorMode?: ColorMode;
  readonly intent?: Intent;
  readonly prompt: string;
  readonly referenceSvg?: string;
  readonly signal?: AbortSignal;
  readonly variantCount?: 1 | 2 | 3;
};

type GenerateResponse = {
  readonly variants: ReadonlyArray<{ id: string; name: string; svg: string }>;
};

// --- [CONSTANTS] -------------------------------------------------------------

// Copy B constant from generation.ts (canvas, layers, palettes, purify config)
const B = Object.freeze({
  ai: { maxTokens: 6000 },
  // ... rest of generation.ts B constant
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

// Copy from generation.ts:
// - buildSystemPrompt()
// - buildUserMessage()
// - parseVariantsResponse()
// - sanitizeSvg()
// - scopeIds()
// - getPalette()

// --- [SERVICE] ---------------------------------------------------------------

class IconGenerationService extends Context.Tag('IconGenerationService')<
  IconGenerationService,
  { readonly generate: (req: GenerateRequest) => Effect.Effect<GenerateResponse, InternalError> }
>() {}

const IconGenerationServiceLive = Layer.effect(
  IconGenerationService,
  Effect.gen(function* () {
    const anthropic = yield* AnthropicClient;

    return IconGenerationService.of({
      generate: (req) =>
        pipe(
          anthropic.send(
            buildSystemPrompt(req),
            [{ content: buildUserMessage(req), role: 'user' }],
            { maxTokens: B.ai.maxTokens, prefill: '{"variants":[', signal: req.signal },
          ),
          Effect.flatMap((text) =>
            Effect.try({
              catch: () => new InternalError({ cause: 'Failed to parse response' }),
              try: () => parseVariantsResponse(text),
            }),
          ),
          Effect.map((output) => ({
            variants: output.variants.map((v) => ({
              ...v,
              svg: sanitizeSvg(v.svg),
            })),
          })),
        ),
    });
  }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { IconGenerationService, IconGenerationServiceLive };
export type { GenerateRequest, GenerateResponse };
```

### [4.2][ROUTE_UPDATE]

```typescript
// apps/api/src/routes/icons.ts
import { IconGenerationService, type GenerateRequest } from '../services/icon-generation.ts';

const handleGenerate = (req: GenerateRequest) =>
  pipe(
    Effect.gen(function* () {
      const session = yield* SessionContext;
      const repos = yield* makeRepositories;
      const iconService = yield* IconGenerationService;

      const result = yield* iconService.generate(req);

      // Store first variant in database
      const asset = yield* repos.assets.insert({
        prompt: S.decodeSync(S.NonEmptyTrimmedString)(req.prompt),
        svg: result.variants[0].svg,
        userId: session.userId,
      });

      return { id: String(asset.id), variants: result.variants };
    }),
    Effect.orDie,
  );
```

### [4.3][MAIN_UPDATE]

```typescript
// apps/api/src/main.ts
import { AnthropicClientLive } from '@parametric-portal/ai/client';
import { IconGenerationServiceLive } from './services/icon-generation.ts';

const ServerLive = HttpApiBuilder.serve().pipe(
  Layer.provide(ApiLive),
  Layer.provide(IconGenerationServiceLive),  // Domain service
  Layer.provide(AnthropicClientLive),         // Generic client
  Layer.provide(PgLive),
  // ...
);
```

---
## [5][ENVIRONMENT_VARIABLES]

### [5.1][ROOT_ENV]

```env
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=parametric
POSTGRES_USER=postgres
POSTGRES_PASSWORD=
POSTGRES_SSL=false

# API Server
API_PORT=4000
API_BASE_URL=http://localhost:4000

# AI (server-side only)
ANTHROPIC_API_KEY=sk-ant-...

# OAuth
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=
OAUTH_MICROSOFT_CLIENT_ID=
OAUTH_MICROSOFT_CLIENT_SECRET=
OAUTH_MICROSOFT_TENANT_ID=common
```

### [5.2][FRONTEND_ENV]

```env
# API URL only - no secrets
VITE_API_URL=http://localhost:4000/api
```

### [5.3][FILE_CHANGES]

| File                         | Change                                    |
| ---------------------------- | ----------------------------------------- |
| `.env.example` (root)        | Create with all server vars               |
| `apps/parametric_icons/.env` | Remove `VITE_ANTHROPIC_API_KEY`           |
| `vite.factory.ts`            | Remove `VITE_ANTHROPIC_API_KEY` injection |
| `pnpm-workspace.yaml`        | Add `isomorphic-dompurify` to catalog     |

---
## [6][HOSTING_ON_HOSTINGER]

### [6.1][VPS_REQUIREMENTS]

| Plan      | vCPU | RAM  | Storage     | Price    |
| --------- | ---- | ---- | ----------- | -------- |
| **KVM 2** | 2    | 8 GB | 100 GB NVMe | $6.99/mo |

Template: Ubuntu 24.04 with Docker. Self-hosted PostgreSQL.

### [6.2][DOCKER_COMPOSE]

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: parametric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env
    ports:
      - "4000:4000"

  frontend:
    build:
      context: .
      dockerfile: apps/parametric_icons/Dockerfile
      args:
        VITE_API_URL: ${API_BASE_URL}/api
    restart: unless-stopped
    depends_on:
      - api
    ports:
      - "3001:80"

volumes:
  postgres_data:
```

### [6.3][GITHUB_ACTIONS]

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hostinger/deploy-on-vps@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: root
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/parametric-portal
            git pull origin main
            docker compose up -d --build
            docker compose exec api pnpm exec nx migrate @parametric-portal/api
```

---
## [7][FRONTEND_INTEGRATION]

### [7.1][API_CLIENT]

Create `apps/parametric_icons/src/api.ts` with fetch wrapper (see previous version).

### [7.2][GENERATION_REFACTOR]

```typescript
// apps/parametric_icons/src/generation.ts
// REMOVE: Anthropic import, client creation, API call
// KEEP: Types, schemas, sanitizeSvg (for client-side preview), constants

import { api } from './api.ts';

const generateIcon = (input: GenerateInput) =>
  api.icons.generate({
    prompt: input.prompt,
    colorMode: input.colorMode,
    intent: input.intent,
    variantCount: input.variantCount,
    referenceSvg: input.referenceSvg,
    attachments: input.attachments,
  });
```

### [7.3][AUTH_UI]

Sidebar avatar/login — use existing OAuth endpoints. No account page needed.

---
## [8][IMPLEMENTATION_ORDER]

| Phase                                 | Tasks                                         |
| ------------------------------------- | --------------------------------------------- |
| **1. Create packages/ai**             | Generic `AnthropicClient` layer               |
| **2. Create icon-generation service** | Port domain logic to `apps/api/src/services/` |
| **3. Delete anthropic.ts**            | Remove mixed-concern file                     |
| **4. Update routes/main**             | Wire up layers                                |
| **5. Environment cleanup**            | Remove browser API key exposure               |
| **6. Frontend refactor**              | Replace Anthropic client with API calls       |
| **7. Auth UI**                        | Login buttons in sidebar                      |
| **8. Docker + Deploy**                | Dockerfiles, compose, GitHub Actions          |

---
## [9][LOCAL_DEVELOPMENT]

```bash
docker compose up postgres -d
pnpm exec nx migrate @parametric-portal/api
pnpm exec nx dev @parametric-portal/api          # port 4000
pnpm exec nx dev @parametric-portal/parametric_icons  # port 3001
```

Swagger: `http://localhost:4000/docs`
