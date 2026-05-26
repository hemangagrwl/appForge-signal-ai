# AppForge

**Natural language → validated, executable app configuration.**

AppForge is a compiler-style pipeline that takes a plain-English app description and produces four validated, cross-consistent schemas (UI, API, DB, Auth) plus executable code artifacts — Prisma schema, Express routes, React pages, and auth middleware — all proven correct by a 14-point simulator and real toolchain checks (`node --check`, `tsc --noEmit`).

```
"Build a CRM with login, contacts, role-based access, and premium payments."
                              ↓
          UI schema · API schema · DB schema · Auth schema
                    Prisma · Express routes · React pages
                         Score: 91%  Grade: A
```

---

## The problem this solves

Single-prompt LLM app generators are unreliable. They hallucinate fields, produce schemas that contradict each other across layers, and output JSON that cannot drive real code generation without manual fixes.

AppForge treats this as a **compiler problem**: break generation into discrete stages with typed contracts between them, validate every output, and repair issues surgically rather than retrying blindly.

---

## Pipeline

```
User Prompt
    │
    ▼
┌─────────────────────────────────────┐
│ Stage 0  Clarification              │  Confidence score · conflict detection
│          confidence < 0.55 → ask    │  Returns questions before wasting tokens
└────────────────────┬────────────────┘
                     │
    ▼
┌─────────────────────────────────────┐
│ Stage 1  Intent Extraction          │  NL → entities, roles, features, pages
└────────────────────┬────────────────┘  Claude call · temp 0.1
                     │
    ▼
┌─────────────────────────────────────┐
│ Stage 2  System Design              │  Routes · API groups · business rules
└────────────────────┬────────────────┘  Claude call · tech stack decisions
                     │
    ▼
┌─────────────────────────────────────┐
│  AppSpec IR  (Zod-validated)        │  Single source of truth for all generators
│  entities · pages · endpoints       │  Consistency guaranteed by construction
│  roles · features · auth config     │  not by repair
└──────┬──────┬──────┬──────┬─────────┘
       │      │      │      │
       ▼      ▼      ▼      ▼       ← all 4 run in Promise.all()
      UI     API     DB    Auth       Claude calls · each reads only AppSpec IR
       │      │      │      │
       └──────┴──────┴──────┘
                     │
    ▼
┌─────────────────────────────────────┐
│ Stage 4/5  Zod Validation + Repair  │  Typed issues → patch operations
│  set_default · add_primary_key      │  Surgical fixes, no blind retry
│  fix_column_type · add_to_array     │  Cross-layer + business logic passes
│  add_users_table · add_role_to_auth │
└────────────────────┬────────────────┘
                     │
    ▼
┌─────────────────────────────────────┐
│ Stage 6  Runtime Generator          │  Prisma schema · Express routers
│                                     │  React page components · auth middleware
└────────────────────┬────────────────┘
                     │
    ▼
┌─────────────────────────────────────┐
│ Stage 7  Simulator + Build Validator│  14-point structural checks
│  node --check on every .js file     │  tsc --noEmit on typed page stubs
│  Prisma model validation            │  Role consistency · FK integrity
└────────────────────┬────────────────┘
                     │
    ▼
┌─────────────────────────────────────┐
│ Stage 8  Evaluator                  │  Completeness 30% · Consistency 25%
│                                     │  Coverage 20% · Executability 15%
│                                     │  Security 10% → letter grade A–F
└─────────────────────────────────────┘
```

**Total per run:** 6–7 Claude API calls · ~5,000–7,000 tokens · ~$0.02–0.04

---

## What gets generated

For a prompt like *"Build a CRM with contacts, deals, login, admin and sales roles, and Stripe payments"*:

**4 validated schemas**
- `ui` — pages, routes, layouts, sections (table/form/stats/chart), field-to-entity mappings
- `api` — endpoints with HTTP method, path, auth flag, role guards, request/response shapes
- `db` — tables, typed columns, primary keys, indexes, foreign key relations
- `auth` — JWT config, role definitions with resource/action permissions, route guards

**Executable artifacts**
```
generated/
  prisma/schema.prisma          ← valid Prisma schema, all models + relations
  api/routes.js                 ← Express main router with auth routes mounted
  api/contactRouter.js          ← CRUD router per entity
  api/dealRouter.js
  auth/middleware.js            ← authenticate() · authorize() · generateToken()
  pages/login.jsx               ← React component with route config export
  pages/dashboard.jsx
  pages/contacts.jsx
  pages/index.js                ← page manifest with all routes
```

Every generated `.js` file passes `node --check`. Entity type stubs pass `tsc --noEmit`.

---

## Quick start

```bash
git clone https://github.com/your-username/appforge
cd appforge
npm install

cp .env.example .env
# add your ANTHROPIC_API_KEY to .env

npm start
# → http://localhost:3000
```

**Requirements:** Node.js 18+ · Anthropic API key

---

## API

### `POST /api/generate`

```json
{ "prompt": "Build a CRM with login, contacts, dashboard...", "skipClarification": false }
```

**Response**
```json
{
  "success": true,
  "runId": "run_1234567890_abc12",
  "appSpec": { ... },
  "schemas": {
    "ui":   { "pages": [...], "theme": {...} },
    "api":  { "endpoints": [...] },
    "db":   { "tables": [...] },
    "auth": { "roles": [...], "strategy": "jwt" }
  },
  "artifacts": {
    "prisma/schema.prisma": "...",
    "api/routes.js": "...",
    "auth/middleware.js": "..."
  },
  "patchLog": { "applied": 3, "skipped": 1, "patches": [...] },
  "simulation": { "executable": true, "summary": { "passed": 14, "total": 14 } },
  "evaluation": { "score": 0.91, "grade": "A" },
  "costMetrics": { "apiCalls": 6, "tokens": { "total": 5840 }, "cost": { "usd": 0.023 } },
  "assumptions": [...],
  "warnings": [...]
}
```

### `GET /api/health`
### `GET /api/examples` — returns the 20-prompt evaluation dataset

---

## File structure

```
appforge/
├── server.js                        Express server · 3 endpoints · 10mb limit
│
├── pipeline/
│   ├── orchestrator.js              10-stage controller · retry · timeout · state tracking
│   ├── stage1_intent.js             NL → IntentObject via Claude
│   ├── stage2_system_design.js      Intent → ArchitectureBlueprint via Claude
│   ├── stage3_schema_gen.js         AppSpec IR → 4 schemas in parallel via Claude
│   ├── clarification.js             Confidence scoring · local conflict detection
│   └── pipelineState.js             PENDING/RUNNING/SUCCESS/REPAIRED/FAILED per stage
│
├── types/
│   └── appSpec.js                   AppSpec IR definition + Zod schema (344 lines)
│                                    buildAppSpec(intent, design) → AppSpec
│
├── schemas/
│   └── zodSchemas.js                Zod validators for UI/API/DB/Auth layers
│                                    validateAllSchemas() → typed ZodIssues
│
├── validation/
│   └── patchRepair.js               Patch engine (389 lines)
│                                    applyPatches(schemas, appSpec) → { schemas, patchLog }
│                                    10 patch operations: set_default, add_primary_key,
│                                    fix_column_type, add_to_array, add_layer,
│                                    add_role_to_auth, add_users_table,
│                                    add_auth_endpoints, reset_enum, fix_path
│
├── runtime/
│   ├── generator.js                 AppSpec IR → file content strings (383 lines)
│   │                                Prisma · Express · React · auth middleware
│   ├── simulator.js                 14-check structural validator (328 lines)
│   │                                Prisma models · API routes · auth exports
│   │                                role consistency · FK integrity · page configs
│   └── buildValidator.js            Real tool execution
│                                    node --check per .js · tsc --noEmit on page stubs
│                                    Prisma schema syntax parser
│
├── evaluation/
│   ├── evaluator.js                 5-dimension quality scorer (241 lines)
│   ├── dataset.js                   20-prompt benchmark dataset
│   │                                10 real: CRM, e-commerce, healthcare, LMS, HR...
│   │                                10 edge: vague, conflicting, incomplete, jargon
│   └── metricsSummary.js            Aggregates across runs: success rate, avg latency,
│                                    p50/p95, failure breakdown, cost per success
│
├── lib/
│   ├── metricsAggregator.js         Run-level metrics store
│   └── modelMetrics.js              Per-model cost/latency/quality tracking
│
├── utils/
│   ├── claude_client.js             Anthropic API wrapper · records token usage
│   ├── json_utils.js                5-strategy JSON parser (fences, commas, extraction)
│   └── metrics.js                   MetricsTracker · tradeoffAnalysis()
│
├── frontend/public/index.html       Single-file UI (617 lines)
│                                    Tabs: Overview · UI · API · DB · Auth · IR
│                                    Simulation · Patches · Artifacts · Eval · Raw JSON
│                                    Live pipeline state panel per stage
│
├── tests/
│   ├── run_tests.js                 24 unit tests (no API key needed)
│   └── eval_benchmark.js            Full 20-prompt benchmark runner
│
├── Dockerfile
├── tsconfig.json
└── .env.example
```

---

## The AppSpec IR

The core design decision. Before v2, each schema generator was its own source of truth, and the repair engine had to reconcile them after the fact. Now:

```
Intent + SystemDesign
        ↓
   buildAppSpec()
        ↓
    AppSpec IR          ← one Zod-validated object
   /    |    \   \
  UI   API   DB  Auth   ← all read the same data
```

Every entity in the IR has a `tableName` (snake_plural), typed `fields`, and `relations`. Every page has a `route`, `layout`, `protected` flag, and `roles`. Every endpoint has an `entity` reference back to the IR. This is what makes cross-layer consistency a structural property rather than something that needs fixing.

---

## Repair engine

Every issue becomes a typed patch, not a prose description:

```js
// Instead of: "the DB is missing a primary key on the contacts table"
{
  operation: 'add_primary_key',
  layer: 'db',
  path: 'tables.0',
  reason: 'Table contacts missing @id field',
}

// Instead of: "the auth schema doesn't have the admin role"
{
  operation: 'add_role_to_auth',
  layer: 'auth',
  value: { name: 'admin', description: 'Admin', permissions: [...] },
  reason: 'Intent role "admin" missing in auth schema',
}
```

Three passes run sequentially: Zod issues → patches, cross-layer consistency patches (roles, users table, auth endpoints), business logic patches (payment gating, pricing page). The patch log in every response shows exactly what changed and why.

---

## Clarification system

Before any API call is made, the prompt is analyzed locally:

| Confidence | Behavior |
|---|---|
| < 0.30 | Returns questions immediately, no API call |
| 0.30 – 0.55 | Returns questions with documented assumptions |
| 0.55 – 0.80 | Proceeds, logs assumptions |
| > 0.80 | Proceeds cleanly |

Conflict detection runs locally (no API): "free app with paid features" and "public but private" patterns are caught before generation starts.

---

## Running tests

```bash
# 24 unit tests — no API key needed
npm test

# Full 20-prompt benchmark — uses API
npm run eval
```

The unit tests cover: Zod validation catches invalid methods/paths/types, AppSpec IR builder produces correct `tableName` and `features`, patch engine applies all 10 operation types correctly, exists-check doesn't false-positive on `undefined === undefined`, simulator detects missing artifacts, clarification engine scores vague/conflicting prompts correctly, JSON parser handles fences/trailing-commas/extraction.

---

## Evaluation dimensions

| Dimension | Weight | What it checks |
|---|---|---|
| Completeness | 30% | All intent entities have a DB table · all intent pages have a UI page · all 4 layers populated |
| Consistency | 25% | Auth roles referenced in endpoints are defined · all DB tables have primary keys |
| Coverage | 20% | Core feature keywords appear somewhere in the generated schemas |
| Executability | 15% | Valid HTTP methods · paths start with `/` · column types are valid SQL types |
| Security | 10% | Sensitive endpoints (create/update/delete/payment) have `auth: true` |

---

## Docker

```bash
docker build -t appforge .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... appforge
```

---

## Design decisions

**Why multi-stage instead of one prompt?** Each stage has a single responsibility and a typed contract. Stage 1 failures don't require re-running Stage 3. Individual stages can be retried without touching the others. Outputs are independently testable.

**Why AppSpec IR?** Without a canonical intermediate representation, each of the four schema generators produces its own version of entities and roles, and the repair engine has to reconcile four conflicting sources of truth. With the IR, reconciliation is a non-problem — all four read the same typed object.

**Why Zod for validation?** `if (!schemas.ui.pages)` doesn't scale and doesn't compose. Zod gives precise error paths (`endpoints[2].method`), automatic coercion of defaults, and typed issues that map directly to patch operations. The same schema that validates also normalizes.

**Why patch-based repair?** Full retry is expensive, non-deterministic, and risks breaking parts of the schema that were already correct. A patch is a surgical operation on a known path with a documented reason. The patch log is auditable. Operations like `add_primary_key` and `fix_column_type` are deterministic — same input always produces same output.

**Why `Promise.all` for schema generation?** UI, API, DB, and Auth schemas are all derived from the AppSpec IR independently. There is no data dependency between them at generation time. Running them in parallel reduces latency by ~60% vs sequential.

---

## License

MIT
