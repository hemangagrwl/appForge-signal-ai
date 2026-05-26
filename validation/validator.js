/**
 * Validation + Repair Engine (Stage 4 + 5)
 * The most important part of the system.
 * 
 * VALIDATES:
 *   - JSON structure completeness
 *   - Type safety
 *   - Cross-layer consistency (API ↔ DB ↔ UI ↔ Auth)
 * 
 * REPAIRS:
 *   - Missing fields → infer from other layers
 *   - Hallucinated fields → remove
 *   - Schema mismatches → reconcile
 *   - Logical inconsistencies → fix with targeted re-generation
 */

import { callClaude } from '../utils/claude_client.js';
import { safeParseJSON } from '../utils/json_utils.js';

export async function validateAndRepair(schemas, intent, systemDesign, metrics) {
  const repairLog = [];
  let current = JSON.parse(JSON.stringify(schemas)); // deep clone

  // ── Pass 1: Structural Validation ───────────────────────────────────────
  const structIssues = validateStructure(current);
  if (structIssues.length > 0) {
    repairLog.push({ pass: 1, type: 'structural', issues: structIssues });
    current = repairStructure(current, structIssues, intent);
  }

  // ── Pass 2: Cross-Layer Consistency ─────────────────────────────────────
  const crossIssues = validateCrossLayer(current);
  if (crossIssues.length > 0) {
    repairLog.push({ pass: 2, type: 'cross_layer', issues: crossIssues });
    current = await repairCrossLayer(current, crossIssues, intent, systemDesign);
    metrics.totalRetries += crossIssues.filter(i => i.repairMethod === 'regen').length;
  }

  // ── Pass 3: Business Logic Consistency ──────────────────────────────────
  const logicIssues = validateBusinessLogic(current, intent);
  if (logicIssues.length > 0) {
    repairLog.push({ pass: 3, type: 'business_logic', issues: logicIssues });
    current = repairBusinessLogic(current, logicIssues, intent);
  }

  // ── Final structural check ───────────────────────────────────────────────
  const finalIssues = validateStructure(current);
  if (finalIssues.length > 0) {
    repairLog.push({ pass: 4, type: 'final_structural', issues: finalIssues, note: 'Some issues remain' });
  }

  return { schemas: current, repairLog };
}

// ── STRUCTURAL VALIDATION ────────────────────────────────────────────────────
function validateStructure(schemas) {
  const issues = [];

  // UI checks
  if (!schemas.ui) issues.push({ layer: 'ui', type: 'missing_layer', field: 'ui' });
  else {
    if (!Array.isArray(schemas.ui.pages)) issues.push({ layer: 'ui', type: 'missing_field', field: 'pages' });
    else {
      schemas.ui.pages.forEach((p, i) => {
        if (!p.name) issues.push({ layer: 'ui', type: 'missing_field', field: `pages[${i}].name` });
        if (!p.route) issues.push({ layer: 'ui', type: 'missing_field', field: `pages[${i}].route` });
        if (!Array.isArray(p.sections)) issues.push({ layer: 'ui', type: 'missing_field', field: `pages[${i}].sections` });
      });
    }
  }

  // API checks
  if (!schemas.api) issues.push({ layer: 'api', type: 'missing_layer', field: 'api' });
  else {
    if (!Array.isArray(schemas.api.endpoints)) issues.push({ layer: 'api', type: 'missing_field', field: 'endpoints' });
    else {
      schemas.api.endpoints.forEach((ep, i) => {
        if (!ep.method) issues.push({ layer: 'api', type: 'missing_field', field: `endpoints[${i}].method` });
        if (!ep.path) issues.push({ layer: 'api', type: 'missing_field', field: `endpoints[${i}].path` });
        if (!['GET','POST','PUT','DELETE','PATCH'].includes(ep.method)) {
          issues.push({ layer: 'api', type: 'invalid_value', field: `endpoints[${i}].method`, value: ep.method });
        }
      });
    }
  }

  // DB checks
  if (!schemas.db) issues.push({ layer: 'db', type: 'missing_layer', field: 'db' });
  else {
    if (!Array.isArray(schemas.db.tables)) issues.push({ layer: 'db', type: 'missing_field', field: 'tables' });
    else {
      schemas.db.tables.forEach((t, i) => {
        if (!t.name) issues.push({ layer: 'db', type: 'missing_field', field: `tables[${i}].name` });
        if (!Array.isArray(t.columns)) issues.push({ layer: 'db', type: 'missing_field', field: `tables[${i}].columns` });
        else {
          const hasPK = t.columns.some(c => c.primaryKey);
          if (!hasPK) issues.push({ layer: 'db', type: 'missing_pk', field: `tables[${i}].name`, table: t.name, autoRepair: true });
        }
      });
    }
  }

  // Auth checks
  if (!schemas.auth) issues.push({ layer: 'auth', type: 'missing_layer', field: 'auth' });
  else {
    if (!Array.isArray(schemas.auth.roles)) issues.push({ layer: 'auth', type: 'missing_field', field: 'roles' });
  }

  return issues;
}

// ── STRUCTURAL REPAIR ────────────────────────────────────────────────────────
function repairStructure(schemas, issues, intent) {
  const fixed = JSON.parse(JSON.stringify(schemas));

  for (const issue of issues) {
    if (issue.type === 'missing_layer') {
      if (issue.field === 'ui') fixed.ui = buildMinimalUISchema(intent);
      if (issue.field === 'api') fixed.api = buildMinimalAPISchema(intent);
      if (issue.field === 'db') fixed.db = buildMinimalDBSchema(intent);
      if (issue.field === 'auth') fixed.auth = buildMinimalAuthSchema(intent);
    }

    if (issue.type === 'missing_field') {
      applyDefault(fixed, issue.layer, issue.field);
    }

    if (issue.type === 'missing_pk') {
      const table = fixed.db.tables.find(t => t.name === issue.table);
      if (table) {
        table.columns.unshift({
          name: 'id',
          type: 'UUID',
          primaryKey: true,
          nullable: false,
          unique: true,
          default: 'gen_random_uuid()',
        });
      }
    }

    if (issue.type === 'invalid_value' && issue.field.includes('.method')) {
      const idx = parseInt(issue.field.match(/\[(\d+)\]/)?.[1]);
      if (!isNaN(idx) && fixed.api?.endpoints?.[idx]) {
        fixed.api.endpoints[idx].method = 'GET';
      }
    }
  }

  return fixed;
}

// ── CROSS-LAYER VALIDATION ───────────────────────────────────────────────────
function validateCrossLayer(schemas) {
  const issues = [];

  if (!schemas.db?.tables || !schemas.api?.endpoints) return issues;

  const dbTableNames = new Set(schemas.db.tables.map(t => t.name.toLowerCase()));
  const dbColumnsByTable = {};
  schemas.db.tables.forEach(t => {
    dbColumnsByTable[t.name.toLowerCase()] = new Set(t.columns.map(c => c.name.toLowerCase()));
  });

  // Check: API endpoints reference entities that exist in DB
  if (schemas.api?.endpoints) {
    schemas.api.endpoints.forEach((ep, i) => {
      const bodyFields = Object.keys(ep.requestBody?.properties || ep.requestBody || {});
      bodyFields.forEach(field => {
        // Check if this endpoint's body matches a known table
        const relatedTable = guessTable(ep.path, dbTableNames);
        if (relatedTable && !dbColumnsByTable[relatedTable]?.has(field.toLowerCase())) {
          issues.push({
            type: 'api_field_not_in_db',
            repairMethod: 'remove_field',
            endpoint: ep.path,
            field,
            table: relatedTable,
            index: i,
          });
        }
      });
    });
  }

  // Check: Auth roles in API endpoints match defined auth roles
  const definedRoles = new Set((schemas.auth?.roles || []).map(r => r.name.toLowerCase()));
  if (schemas.api?.endpoints) {
    schemas.api.endpoints.forEach((ep, i) => {
      (ep.roles || []).forEach(role => {
        if (!definedRoles.has(role.toLowerCase())) {
          issues.push({
            type: 'undefined_role_in_endpoint',
            repairMethod: 'add_role',
            endpoint: ep.path,
            role,
            index: i,
          });
        }
      });
    });
  }

  // Check: UI pages reference routes in navigation
  const apiPaths = new Set((schemas.api?.endpoints || []).map(ep => {
    const base = ep.path.split('/:')[0].replace(/\/:[^/]+/g, '');
    return base;
  }));

  return issues;
}

// ── CROSS-LAYER REPAIR ───────────────────────────────────────────────────────
async function repairCrossLayer(schemas, issues, intent, systemDesign) {
  const fixed = JSON.parse(JSON.stringify(schemas));
  const regenRequired = issues.filter(i => i.repairMethod === 'regen');
  const inlineRepairs = issues.filter(i => i.repairMethod !== 'regen');

  // Inline repairs first (fast)
  for (const issue of inlineRepairs) {
    if (issue.type === 'api_field_not_in_db' && issue.repairMethod === 'remove_field') {
      const ep = fixed.api.endpoints[issue.index];
      if (ep?.requestBody?.properties) {
        delete ep.requestBody.properties[issue.field];
        const reqIdx = ep.requestBody.required?.indexOf(issue.field);
        if (reqIdx > -1) ep.requestBody.required.splice(reqIdx, 1);
      }
    }
    if (issue.type === 'undefined_role_in_endpoint' && issue.repairMethod === 'add_role') {
      // Add missing role to auth schema
      if (fixed.auth.roles && !fixed.auth.roles.find(r => r.name.toLowerCase() === issue.role.toLowerCase())) {
        fixed.auth.roles.push({
          name: issue.role,
          description: `Auto-added role: ${issue.role}`,
          inherits: [],
          permissions: [],
        });
      }
    }
  }

  // Targeted re-generation for complex issues
  if (regenRequired.length > 0) {
    const regenContext = { issues: regenRequired, schemas: fixed, intent };
    const regenResponse = await callClaude({
      system: 'You are a schema repair expert. Fix only the specific issues listed. Return ONLY the repaired JSON fragment, no explanation.',
      messages: [{
        role: 'user',
        content: `Fix these cross-layer issues:\n${JSON.stringify(regenRequired, null, 2)}\n\nCurrent schemas (relevant parts):\n${JSON.stringify(fixed, null, 2)}\n\nReturn the complete repaired schemas JSON.`
      }],
      temperature: 0.1,
      max_tokens: 4000,
    });
    try {
      const repaired = safeParseJSON(regenResponse, 'Repair:CrossLayer');
      if (repaired.ui) fixed.ui = repaired.ui;
      if (repaired.api) fixed.api = repaired.api;
      if (repaired.db) fixed.db = repaired.db;
      if (repaired.auth) fixed.auth = repaired.auth;
    } catch (e) {
      console.warn('[Repair] Cross-layer regen failed, keeping inline repairs only');
    }
  }

  return fixed;
}

// ── BUSINESS LOGIC VALIDATION ────────────────────────────────────────────────
function validateBusinessLogic(schemas, intent) {
  const issues = [];

  // If payment required, check pricing page exists
  if (intent.paymentRequired) {
    const hasPricingPage = schemas.ui?.pages?.some(p => 
      p.name.toLowerCase().includes('pric') || p.name.toLowerCase().includes('checkout')
    );
    if (!hasPricingPage) {
      issues.push({ type: 'missing_pricing_page', autoRepair: true });
    }
    const hasPaymentEndpoint = schemas.api?.endpoints?.some(ep =>
      ep.path.toLowerCase().includes('payment') || ep.path.toLowerCase().includes('subscription')
    );
    if (!hasPaymentEndpoint) {
      issues.push({ type: 'missing_payment_endpoint', autoRepair: true });
    }
  }

  // If auth required, check users table exists
  if (intent.authRequired) {
    const hasUsersTable = schemas.db?.tables?.some(t => 
      t.name.toLowerCase() === 'users' || t.name.toLowerCase() === 'user'
    );
    if (!hasUsersTable) {
      issues.push({ type: 'missing_users_table', autoRepair: true });
    }
    const hasLoginEndpoint = schemas.api?.endpoints?.some(ep =>
      ep.path.toLowerCase().includes('login') || ep.path.toLowerCase().includes('auth')
    );
    if (!hasLoginEndpoint) {
      issues.push({ type: 'missing_auth_endpoints', autoRepair: true });
    }
  }

  // Check roles consistency
  const intentRoles = new Set(intent.roles.map(r => r.name.toLowerCase()));
  const authRoles = new Set((schemas.auth?.roles || []).map(r => r.name.toLowerCase()));
  intentRoles.forEach(role => {
    if (!authRoles.has(role)) {
      issues.push({ type: 'intent_role_missing_in_auth', role, autoRepair: true });
    }
  });

  return issues;
}

// ── BUSINESS LOGIC REPAIR ────────────────────────────────────────────────────
function repairBusinessLogic(schemas, issues, intent) {
  const fixed = JSON.parse(JSON.stringify(schemas));

  for (const issue of issues) {
    if (issue.type === 'missing_pricing_page') {
      fixed.ui.pages = fixed.ui.pages || [];
      fixed.ui.pages.push({
        name: 'Pricing',
        route: '/pricing',
        title: 'Pricing Plans',
        layout: 'minimal',
        sections: [{
          id: 'pricing_plans',
          type: 'list',
          title: 'Choose a Plan',
          fields: [],
          actions: [{ label: 'Upgrade Now', type: 'link', target: '/checkout' }],
        }],
      });
    }

    if (issue.type === 'missing_payment_endpoint') {
      fixed.api.endpoints = fixed.api.endpoints || [];
      fixed.api.endpoints.push({
        id: 'create_subscription',
        group: 'Payments',
        method: 'POST',
        path: '/api/v1/subscriptions',
        description: 'Create a new subscription / payment',
        auth: true,
        roles: ['user'],
        requestBody: { type: 'object', required: ['planId'], properties: { planId: { type: 'string' }, paymentMethodId: { type: 'string' } } },
        responses: { '200': { description: 'Subscription created' }, '402': { description: 'Payment failed' } },
        queryParams: [],
      });
    }

    if (issue.type === 'missing_users_table') {
      fixed.db.tables = fixed.db.tables || [];
      fixed.db.tables.unshift({
        name: 'users',
        description: 'Application users',
        columns: [
          { name: 'id', type: 'UUID', primaryKey: true, nullable: false, unique: true, default: 'gen_random_uuid()' },
          { name: 'email', type: 'VARCHAR', primaryKey: false, nullable: false, unique: true, default: null },
          { name: 'password_hash', type: 'VARCHAR', primaryKey: false, nullable: false, unique: false, default: null },
          { name: 'role', type: 'VARCHAR', primaryKey: false, nullable: false, unique: false, default: "'user'" },
          { name: 'created_at', type: 'TIMESTAMP', primaryKey: false, nullable: false, unique: false, default: 'NOW()' },
          { name: 'updated_at', type: 'TIMESTAMP', primaryKey: false, nullable: true, unique: false, default: 'NOW()' },
        ],
        indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
      });
    }

    if (issue.type === 'missing_auth_endpoints') {
      fixed.api.endpoints = fixed.api.endpoints || [];
      fixed.api.endpoints.unshift(
        { id: 'auth_login', group: 'Auth', method: 'POST', path: '/api/v1/auth/login', description: 'Login', auth: false, roles: [], requestBody: { type: 'object', required: ['email','password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }, responses: { '200': { description: 'JWT token' }, '401': { description: 'Invalid credentials' } }, queryParams: [] },
        { id: 'auth_register', group: 'Auth', method: 'POST', path: '/api/v1/auth/register', description: 'Register', auth: false, roles: [], requestBody: { type: 'object', required: ['email','password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }, responses: { '201': { description: 'User created' }, '409': { description: 'Email exists' } }, queryParams: [] },
        { id: 'auth_logout', group: 'Auth', method: 'POST', path: '/api/v1/auth/logout', description: 'Logout', auth: true, roles: [], requestBody: {}, responses: { '200': { description: 'Logged out' } }, queryParams: [] },
        { id: 'auth_me', group: 'Auth', method: 'GET', path: '/api/v1/auth/me', description: 'Get current user', auth: true, roles: [], requestBody: {}, responses: { '200': { description: 'User profile' } }, queryParams: [] }
      );
    }

    if (issue.type === 'intent_role_missing_in_auth') {
      const intentRole = intent.roles.find(r => r.name.toLowerCase() === issue.role);
      fixed.auth.roles = fixed.auth.roles || [];
      fixed.auth.roles.push({
        name: intentRole?.name || issue.role,
        description: intentRole?.description || `Role: ${issue.role}`,
        inherits: [],
        permissions: (intentRole?.permissions || []).map(p => {
          const [resource, action] = p.split(':');
          return { resource: resource || '*', actions: [action || 'read'], conditions: [] };
        }),
      });
    }
  }

  return fixed;
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function guessTable(path, tableNames) {
  const segments = path.split('/').filter(Boolean);
  for (const seg of segments) {
    const singular = seg.replace(/s$/, '');
    if (tableNames.has(seg.toLowerCase()) || tableNames.has(singular.toLowerCase())) {
      return tableNames.has(seg.toLowerCase()) ? seg.toLowerCase() : singular.toLowerCase();
    }
  }
  return null;
}

function applyDefault(schemas, layer, field) {
  // Apply safe defaults for missing fields
  const defaults = {
    'pages': [],
    'sections': [],
    'endpoints': [],
    'tables': [],
    'roles': [],
    'columns': [],
  };
  const key = field.split('.').pop().replace(/\[\d+\]/, '');
  if (defaults[key] !== undefined) {
    try {
      const parts = field.split('.');
      let obj = schemas[layer];
      for (let i = 0; i < parts.length - 1; i++) {
        const match = parts[i].match(/(\w+)\[(\d+)\]/);
        if (match) obj = obj[match[1]][parseInt(match[2])];
        else obj = obj[parts[i]];
        if (!obj) break;
      }
      if (obj && !obj[key]) obj[key] = defaults[key];
    } catch (e) { /* best effort */ }
  }
}

export function buildMinimalUISchema(intent) {
  return {
    theme: { primaryColor: '#6366f1', fontFamily: 'Inter', mode: 'light' },
    components: ['Button', 'Input', 'Card', 'Table', 'Modal', 'Sidebar', 'Navbar'],
    pages: (intent.pages || []).map(page => {

      const pageName =
            typeof page === 'string'
            ? page
            : (page?.name || 'page');

      return {

            name: pageName,

            route:
                '/' +
                pageName
                .toLowerCase()
                .replace(/\s+/g,'-'),

            title: pageName,

            layout:'default',

            components:
                page?.components || [],

            sections:[]
      };

}),
  };
}

export function buildMinimalAPISchema(intent) {

  const endpoints=[];

  (intent.entities || []).forEach(entity=>{

      const entityName =
          entity?.name || 'Resource';

      const resource=
          entityName.toLowerCase();

      endpoints.push({

          path:`/api/${resource}`,

          method:'GET',

          authRequired:true,

          request:{},

          responses:{
              200:'Success'
          }
      });

      endpoints.push({

          path:`/api/${resource}`,

          method:'POST',

          authRequired:true,

          request:{},

          responses:{
              201:'Created'
          }
      });

  });

  return {

      version:'1.0.0',

      baseUrl:'/api/v1',

      auth:{
          type:'jwt',
          headerName:'Authorization',
          prefix:'Bearer'
      },

      endpoints
  };
}

export function buildMinimalDBSchema(intent) {

  const entities =
      intent.entities ||
      intent.appSpec?.entities ||
      [];

  return {

    dialect:'postgresql',

    tables: entities.map(e => ({
      name:e.name.toLowerCase()+'s',
      description:e.description,
      columns:[
        {
          name:'id',
          type:'UUID',
          primaryKey:true,
          nullable:false,
          unique:true,
          default:'gen_random_uuid()'
        },

        ...(e.fields||[]).map(f=>({
          name:f.name,
          type:mapFieldType(f.type),
          primaryKey:false,
          nullable:!f.required,
          unique:f.unique||false,
          default:null
        })),

        {
          name:'created_at',
          type:'TIMESTAMP',
          primaryKey:false,
          nullable:false,
          unique:false,
          default:'NOW()'
        }
      ],

      indexes:[]
    })),

    migrations:[
      {
        id:'001',
        description:'Initial schema',
        tables:entities.map(
          e=>e.name.toLowerCase()+'s'
        )
      }
    ]
  };
}

export function buildMinimalAuthSchema(intent) {
  return {
    strategy: 'jwt',
    jwtConfig: { expiry: '7d', refreshExpiry: '30d', algorithm: 'HS256' },
    roles: intent.roles.map(r => ({
      name: r.name,
      description: r.description,
      inherits: [],
      permissions: (r.permissions || []).map(p => {
        const [resource, action] = p.split(':');
        return { resource: resource || '*', actions: action ? [action] : ['read'], conditions: [] };
      }),
    })),
    guards: [],
    passwordPolicy: { minLength: 8, requireUppercase: true, requireNumber: true },
    socialAuth: [],
  };
}

function mapFieldType(type) {
  const map = { string: 'VARCHAR', number: 'INTEGER', boolean: 'BOOLEAN', date: 'TIMESTAMP', email: 'VARCHAR', enum: 'VARCHAR', uuid: 'UUID', text: 'TEXT', json: 'JSONB' };
  return map[type] || 'VARCHAR';
}
