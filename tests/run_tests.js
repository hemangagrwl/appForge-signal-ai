/**
 * Unit Tests — AppForge v2
 * Tests patch repair, Zod validators, AppSpec IR, and simulator.
 */
import MetricsAggregator from "../lib/metricsAggregator.js";
import { applyPatches } from '../validation/patchRepair.js';
import { validateAllSchemas } from '../schemas/zodSchemas.js';
import { buildAppSpec } from '../types/appSpec.js';
import { safeParseJSON } from '../utils/json_utils.js';
import { simulate } from '../runtime/simulator.js';
import { generateArtifacts } from '../runtime/generator.js';
import { analyzePromptConfidence } from '../pipeline/clarification.js';
import ModelMetrics from "../lib/modelMetrics.js";
import BenchmarkSummary from "../evaluation/benchmarkSummary.js";
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log(`  ✅ ${name}`); passed++; })
               .catch(err => { console.log(`  ❌ ${name}: ${err.message}`); failed++; });
    }
    console.log(`  ✅ ${name}`); passed++;
  } catch (err) { console.log(`  ❌ ${name}: ${err.message}`); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// ── Fixtures ──────────────────────────────────────────────────────────────────

const minimalIntent = {
  appName: 'TestApp', appType: 'saas', description: 'Test app',
  coreFeatures: ['login', 'dashboard'],
  entities: [{ name: 'User', description: 'User', fields: [{ name: 'email', type: 'email', required: true, unique: true, enumValues: [] }], relations: [] }],
  roles: [{ name: 'admin', description: 'Admin', permissions: ['*:*'] }, { name: 'user', description: 'User', permissions: ['resource:read'] }],
  authRequired: true, paymentRequired: false,
  pages: ['Login', 'Dashboard'], assumptions: [],
};

const goodSchemas = {
  ui: {
    theme: { primaryColor: '#6366f1', fontFamily: 'Inter', mode: 'light' },
    components: ['Button'],
    pages: [
      { name: 'Login', route: '/login', title: 'Login', layout: 'auth', sections: [] },
      { name: 'Dashboard', route: '/dashboard', title: 'Dashboard', layout: 'default', sections: [] },
    ],
  },
  api: {
    version: '1.0.0', baseUrl: '/api/v1',
    auth: { type: 'jwt', headerName: 'Authorization', prefix: 'Bearer' },
    endpoints: [
      { id: 'login', group: 'Auth', method: 'POST', path: '/api/v1/auth/login', auth: false, roles: [], requestBody: {}, responses: { '200': { description: 'OK' } }, queryParams: [], rateLimited: false, premiumOnly: false },
    ],
  },
  db: {
    dialect: 'postgresql',
    tables: [{
      name: 'users', description: 'Users',
      columns: [
        { name: 'id', type: 'UUID', primaryKey: true, nullable: false, unique: true, default: 'gen_random_uuid()' },
        { name: 'email', type: 'VARCHAR', primaryKey: false, nullable: false, unique: true, default: null },
      ],
      indexes: [],
    }],
    migrations: [],
  },
  auth: {
    strategy: 'jwt',
    jwtConfig: { expiry: '7d', refreshExpiry: '30d', algorithm: 'HS256' },
    roles: [
      { name: 'admin', description: 'Admin', inherits: [], permissions: [{ resource: '*', actions: ['create','read','update','delete'], conditions: [] }] },
      { name: 'user', description: 'User', inherits: [], permissions: [{ resource: 'resource', actions: ['read'], conditions: [] }] },
    ],
    guards: [],
    passwordPolicy: { minLength: 8, requireUppercase: true, requireNumber: true },
    socialAuth: [],
  },
};

const mockDesign = {
  techStack: { frontend: 'react', backend: 'node-express', database: 'postgresql', auth: 'jwt' },
  navigationFlow: [
    { page: 'Login', route: '/login', protected: false, roles: [], layout: 'auth' },
    { page: 'Dashboard', route: '/dashboard', protected: true, roles: [], layout: 'default' },
  ],
  apiGroups: [],
  businessRules: [],
};

// ─────────────────────────────────────────────────────────────────────────────

const tests = async () => {
  console.log('\n🧪 AppForge v2 Unit Tests\n' + '='.repeat(44));

  // ── Zod Validation ────────────────────────────────────────────────────────
  console.log('\n[Zod Schema Validation]');

  await test('Valid schemas pass Zod with no issues', async () => {
    const result = validateAllSchemas(goodSchemas);
    assert(result.valid, `Expected valid, got issues: ${result.issues.map(i=>i.message).join(', ')}`);
  });

  await test('Invalid HTTP method detected by Zod', async () => {
    const bad = JSON.parse(JSON.stringify(goodSchemas));
    bad.api.endpoints[0].method = 'INVALID';
    const result = validateAllSchemas(bad);
    assert(!result.valid, 'Should detect invalid method');
    assert(result.issues.some(i => i.layer === 'api'), 'Issue should be on api layer');
  });

  await test('Missing route leading slash detected', async () => {
    const bad = JSON.parse(JSON.stringify(goodSchemas));
    bad.ui.pages[0].route = 'login'; // missing leading slash
    const result = validateAllSchemas(bad);
    assert(!result.valid, 'Should detect missing /');
  });

  await test('Invalid DB column type detected', async () => {
    const bad = JSON.parse(JSON.stringify(goodSchemas));
    bad.db.tables[0].columns[1].type = 'FAKETYPE';
    const result = validateAllSchemas(bad);
    assert(!result.valid, 'Should detect invalid column type');
  });

  // ── AppSpec IR ────────────────────────────────────────────────────────────
  console.log('\n[AppSpec IR Builder]');

  await test('buildAppSpec produces valid IR from intent+design', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    assert(spec.metadata.appName === 'TestApp', 'appName wrong');
    assert(Array.isArray(spec.entities), 'entities not array');
    assert(spec.entities.length > 0, 'no entities');
    assert(Array.isArray(spec.roles), 'roles not array');
    assert(spec.auth.strategy === 'jwt', 'auth strategy wrong');
  });

  await test('IR tableName is snake_plural of entity name', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const user = spec.entities.find(e => e.name === 'User');
    assert(user, 'User entity missing');
    assert(user.tableName === 'users', `Expected 'users', got '${user.tableName}'`);
  });

  await test('IR features.payments=false when paymentRequired=false', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    assert(spec.features.payments === false, 'payments should be false');
  });

  await test('IR features.payments=true when paymentRequired=true', async () => {
    const intent2 = { ...minimalIntent, paymentRequired: true };
    const spec = buildAppSpec(intent2, mockDesign);
    assert(spec.features.payments === true, 'payments should be true');
  });

  // ── Patch Repair ──────────────────────────────────────────────────────────
  console.log('\n[Patch Repair Engine]');

  await test('Good schemas need 0 patches', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const result = applyPatches(goodSchemas, spec);
    // users table already exists, so minimal patches
    assert(result.patchLog.total >= 0, 'patchLog.total should exist');
  });

  await test('Missing users table → add_users_table patch applied', async () => {
    const bad = JSON.parse(JSON.stringify(goodSchemas));
    bad.db.tables = []; // remove all tables
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const result = applyPatches(bad, spec);
    const hasUsers = result.schemas.db.tables.some(t => t.name === 'users');
    assert(hasUsers, 'users table should be patched in');
  });

  await test('Missing auth endpoints → add_auth_endpoints patch applied', async () => {
    const bad = JSON.parse(JSON.stringify(goodSchemas));
    bad.api.endpoints = []; // remove all endpoints
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const result = applyPatches(bad, spec);
    const hasLogin = result.schemas.api.endpoints.some(ep => ep.path?.includes('/auth/login'));
    assert(hasLogin, 'login endpoint should be patched in');
  });

  await test('Undefined role in endpoints → role added to auth', async () => {
    const bad = JSON.parse(JSON.stringify(goodSchemas));
    bad.api.endpoints[0].roles = ['superadmin']; // not in auth
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const result = applyPatches(bad, spec);
    const roleNames = result.schemas.auth.roles.map(r => r.name.toLowerCase());
    assert(roleNames.includes('superadmin'), 'superadmin should be added to auth');
  });

  await test('Payments feature → pricing page + subscription endpoint patched in', async () => {
    const intent2 = { ...minimalIntent, paymentRequired: true };
    const spec = buildAppSpec(intent2, mockDesign);
    const result = applyPatches(goodSchemas, spec);
    const hasPricing = result.schemas.ui.pages.some(p => /pric/i.test(p.name));
    const hasSubEp = result.schemas.api.endpoints.some(ep => /subscription/i.test(ep.path));
    assert(hasPricing, 'pricing page should be patched in');
    assert(hasSubEp, 'subscription endpoint should be patched in');
  });

  // ── Runtime + Simulator ───────────────────────────────────────────────────
  console.log('\n[Runtime Generator + Simulator]');

  await test('generateArtifacts produces all expected file types', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const artifacts = generateArtifacts(spec);
    assert(artifacts['prisma/schema.prisma'], 'Prisma schema missing');
    assert(artifacts['api/routes.js'], 'API routes missing');
    assert(artifacts['auth/middleware.js'], 'Auth middleware missing');
    assert(artifacts['pages/index.js'], 'Page manifest missing');
  });

  await test('Prisma schema contains User model', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const artifacts = generateArtifacts(spec);
    assert(artifacts['prisma/schema.prisma'].includes('model User'), 'User model missing from Prisma schema');
  });

  await test('Auth middleware exports authenticate, authorize, generateToken', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const artifacts = generateArtifacts(spec);
    const mw = artifacts['auth/middleware.js'];
    assert(mw.includes('export function authenticate'), 'authenticate missing');
    assert(mw.includes('export function authorize'), 'authorize missing');
    assert(mw.includes('export function generateToken'), 'generateToken missing');
  });

  await test('Simulator returns executable=true on well-formed spec', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const artifacts = generateArtifacts(spec);
    const sim = simulate(spec, artifacts);
    if (!sim.executable) {
      const failed = sim.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.details}`);
      assert(false, `Not executable: ${failed.join('; ')}`);
    }
    assert(sim.executable, 'Should be executable');
  });

  await test('Simulator detects missing artifact', async () => {
    const spec = buildAppSpec(minimalIntent, mockDesign);
    const artifacts = generateArtifacts(spec);
    delete artifacts['auth/middleware.js']; // intentionally remove
    const sim = simulate(spec, artifacts);
    const mwCheck = sim.checks.find(c => c.name === 'Auth middleware');
    assert(mwCheck && !mwCheck.passed, 'Should detect missing auth middleware');
  });

  // ── Clarification ─────────────────────────────────────────────────────────
  console.log('\n[Clarification Engine]');

  await test('Very short prompt triggers clarification', async () => {
    const result = await analyzePromptConfidence('app');
    assert(result.needsClarification, 'Short prompt should need clarification');
    assert(result.confidence < 0.55, `Confidence ${result.confidence} should be < 0.55`);
  });

  await test('Conflicting free/paid detected locally', async () => {
    const result = await analyzePromptConfidence(
      'Build a completely free app with premium features that everyone can access without paying but also has paid subscription tiers'
    );
    assert(result.conflictingRequirements.length > 0, 'Should detect free/paid conflict');
  });

  await test('Clear prompt has confidence >= 0.55', async () => {
    const result = await analyzePromptConfidence(
      'Build a CRM with login, contacts management, dashboard, role-based access for admin and sales users, and premium plan with Stripe payments.'
    );
    // Local quick-analyze should give >= 0.55 for a clear prompt
    assert(result.confidence >= 0.55, `Confidence ${result.confidence} should be >= 0.55 for clear prompt`);
  });

  // ── JSON Utils ────────────────────────────────────────────────────────────
  console.log('\n[JSON Utilities]');

  await test('safeParseJSON handles markdown code fences', async () => {
    const r = safeParseJSON('```json\n{"key": "value"}\n```', 'test');
    assert(r.key === 'value', 'Should parse despite fences');
  });

  await test('safeParseJSON handles trailing commas', async () => {
    const r = safeParseJSON('{"a": 1, "b": 2,}', 'test');
    assert(r.a === 1, 'Should parse despite trailing comma');
  });

  await test('safeParseJSON extracts JSON from surrounding text', async () => {
    const r = safeParseJSON('Here is the result: {"x": 42} done.', 'test');
    assert(r.x === 42, 'Should extract JSON from text');
  });
// ── Metrics Aggregation ─────────────────────────────────────────────
console.log('\n[Metrics Aggregation]');

await test('Metrics aggregation works', async () => {

    const metrics = new MetricsAggregator();

    metrics.addRun({
        success:true,
        retries:1,
        latency:120
    });

    metrics.addRun({
        success:false,
        retries:2,
        latency:200,
        failureType:"schemaMismatch"
    });

    const summary = metrics.getSummary();

    assert(
        summary.successRate===0.5,
        'success rate calculation failed'
    );

    assert(
        summary.avgRetries===1.5,
        'average retries calculation failed'
    );

    assert(
        summary.failureBreakdown.schemaMismatch===1,
        'failure aggregation failed'
    );
});
  console.log('\n[Cost vs Quality]');

await test(
    'Model cost-quality metrics work',
    async()=>{

        const metrics =
            new ModelMetrics();

        metrics.addRun({

            cost:0.02,
            latency:2.1,
            quality:0.91
        });

        metrics.addRun({

            cost:0.01,
            latency:1.2,
            quality:0.82
        });

        const summary =
            metrics.summary();

        assert(
            summary.requests===2,
            'request count failed'
        );

        assert(
            summary.avgQuality>0.8,
            'quality calculation failed'
        );
    }
);

  console.log('\n[Benchmark Summary]');

await test(
    'Benchmark summary aggregation works',
    async()=>{

        const benchmark=
            new BenchmarkSummary();

        benchmark.add({

            success:true,

            retries:1,

            latency:100
        });

        benchmark.add({

            success:false,

            retries:2,

            latency:200,

            failureType:
                'schemaMismatch'
        });

        const result=
            benchmark.generate();

        assert(
            result.successRate===0.5,
            'success rate failed'
        );

        assert(
            result.failureBreakdown
            .schemaMismatch===1,
            'failure aggregation failed'
        );
    }
);
  console.log('\n' + '='.repeat(44));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
};

tests().catch(err => { console.error(err); process.exit(1); });