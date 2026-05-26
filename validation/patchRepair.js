/**
 * Patch-based Repair Engine
 * Instead of overwriting entire sections, applies surgical JSON patches.
 * Every change is logged as: { operation, target, value, reason }
 *
 * Operations:
 *   add       → insert into array or add object key
 *   set       → overwrite a value
 *   remove    → remove key or array item
 *   fix_type  → coerce to correct type
 *   reset     → reset to safe default
 */

import { validateAllSchemas, zodIssueToPatch } from '../schemas/zodSchemas.js';

// ── Main entry ────────────────────────────────────────────────────────────────

export function applyPatches(schemas, appSpec) {
  // First run: Zod validation → typed issues → patches
  const validation = validateAllSchemas(schemas);
  const zodPatches = validation.issues.map(issue => zodIssueToPatch(issue));
  
  // Second run: cross-layer + business logic patches
  const crossPatches = generateCrossLayerPatches(schemas, appSpec);
  const businessPatches = generateBusinessLogicPatches(schemas, appSpec);

  const allPatches = [...zodPatches, ...crossPatches, ...businessPatches];

  // Apply all patches sequentially
  let current = JSON.parse(JSON.stringify(schemas));
  const applied = [];
  const skipped = [];

  for (const patch of allPatches) {
    try {
      const result = applyPatch(current, patch);
      if (result.changed) {
        applied.push({ ...patch, applied: true });
        current = result.schemas;
      } else {
        skipped.push({ ...patch, reason: 'No change needed' });
      }
    } catch (err) {
      skipped.push({ ...patch, reason: `Apply failed: ${err.message}` });
    }
  }

  // Final Zod pass to get coerced/defaulted data
  const finalValidation = validateAllSchemas(current);
  if (finalValidation.data) {
    current = {
      ui: finalValidation.data.ui || current.ui,
      api: finalValidation.data.api || current.api,
      db: finalValidation.data.db || current.db,
      auth: finalValidation.data.auth || current.auth,
    };
  }

  return {
    schemas: current,
    patchLog: {
      total: allPatches.length,
      applied: applied.length,
      skipped: skipped.length,
      patches: applied,
      skippedPatches: skipped,
    },
    valid: finalValidation.valid,
    remainingIssues: finalValidation.issues,
  };
}

// ── Patch applicator ──────────────────────────────────────────────────────────

function applyPatch(schemas, patch) {
  const result = JSON.parse(JSON.stringify(schemas));
  let changed = false;

  const layer = result[patch.layer];
  if (!layer && patch.operation !== 'add_layer') {
    return { schemas: result, changed: false };
  }

  switch (patch.operation) {

    case 'set_default': {
      const target = resolveTarget(result, patch.layer, patch.path);
      if (target && target.obj[target.key] === undefined) {
        target.obj[target.key] = patch.value ?? getDefault(patch.path);
        changed = true;
      }
      break;
    }

    case 'reset_enum': {
      const target = resolveTarget(result, patch.layer, patch.path);
      if (target && patch.validValues) {
        target.obj[target.key] = patch.validValues[0];
        changed = true;
      }
      break;
    }

    case 'add_primary_key': {
      const tableMatch = patch.path?.match(/tables\.(\d+)/);
      if (tableMatch && result.db?.tables) {
        const table = result.db.tables[parseInt(tableMatch[1])];
        if (table && !table.columns?.some(c => c.primaryKey)) {
          table.columns.unshift({
            name: 'id', type: 'UUID', primaryKey: true,
            nullable: false, unique: true, default: 'gen_random_uuid()',
          });
          changed = true;
        }
      }
      break;
    }

    case 'fix_path': {
      const target = resolveTarget(result, patch.layer, patch.path);
      if (target && typeof target.obj[target.key] === 'string' && !target.obj[target.key].startsWith('/')) {
        target.obj[target.key] = '/' + target.obj[target.key];
        changed = true;
      }
      break;
    }

    case 'fix_column_type': {
      const target = resolveTarget(result, patch.layer, patch.path);
      if (target) {
        const current = target.obj[target.key];
        const mapped = mapToValidDBType(current);
        if (mapped !== current) {
          target.obj[target.key] = mapped;
          changed = true;
        }
      }
      break;
    }

    case 'add_to_array': {
      const target = resolveTarget(result, patch.layer, patch.arrayPath || patch.path);
      if (target && Array.isArray(target.obj[target.key])) {
        const exists = target.obj[target.key].some(item => {
          if (patch.value?.name !== undefined && item.name === patch.value.name) return true;
          if (patch.value?.id !== undefined && item.id === patch.value.id) return true;
          return false;
        });
        if (!exists) {
          target.obj[target.key].push(patch.value);
          changed = true;
        }
      }
      break;
    }

    case 'add_layer': {
      if (!result[patch.layer]) {
        result[patch.layer] = patch.value;
        changed = true;
      }
      break;
    }

    case 'add_role_to_auth': {
      if (result.auth?.roles && !result.auth.roles.find(r => r.name.toLowerCase() === patch.value?.name?.toLowerCase())) {
        result.auth.roles.push(patch.value);
        changed = true;
      }
      break;
    }

    case 'add_users_table': {
      if (result.db?.tables && !result.db.tables.find(t => t.name === 'users')) {
        result.db.tables.unshift(buildUsersTable());
        changed = true;
      }
      break;
    }

    case 'add_auth_endpoints': {
      if (result.api?.endpoints) {
        const hasLogin = result.api.endpoints.some(ep => ep.path?.includes('/auth/login'));
        if (!hasLogin) {
          result.api.endpoints.unshift(...buildAuthEndpoints());
          changed = true;
        }
      }
      break;
    }

    case 'log_only':
      // No change, just logging
      break;
  }

  return { schemas: result, changed };
}

// ── Cross-layer patch generators ──────────────────────────────────────────────

function generateCrossLayerPatches(schemas, appSpec) {
  const patches = [];

  if (!appSpec) return patches;

  // Missing users table
  const hasUsers = schemas.db?.tables?.some(t => t.name?.toLowerCase() === 'users');
  if (!hasUsers) {
    patches.push({
      operation: 'add_users_table',
      layer: 'db',
      reason: 'Auth requires users table',
    });
  }

  // Missing auth endpoints
  const hasLogin = schemas.api?.endpoints?.some(ep => ep.path?.includes('/auth'));
  if (!hasLogin) {
    patches.push({
      operation: 'add_auth_endpoints',
      layer: 'api',
      reason: 'Auth required but no auth endpoints found',
    });
  }

  // Roles referenced in endpoints not defined in auth
  const definedRoles = new Set((schemas.auth?.roles || []).map(r => r.name.toLowerCase()));
  const referencedRoles = new Set();
  (schemas.api?.endpoints || []).forEach(ep => {
    (ep.roles || []).forEach(r => referencedRoles.add(r.toLowerCase()));
  });

  referencedRoles.forEach(role => {
    if (!definedRoles.has(role)) {
      patches.push({
        operation: 'add_role_to_auth',
        layer: 'auth',
        path: 'roles',
        value: {
          name: role,
          description: `Auto-added role: ${role}`,
          inherits: [],
          permissions: [],
        },
        reason: `Role "${role}" used in endpoints but not defined in auth`,
      });
    }
  });

  // Ensure AppSpec roles exist in auth schema
  (appSpec.roles || []).forEach(role => {
    if (!definedRoles.has(role.name.toLowerCase()) && !referencedRoles.has(role.name.toLowerCase())) {
      patches.push({
        operation: 'add_role_to_auth',
        layer: 'auth',
        value: {
          name: role.name,
          description: role.description || '',
          inherits: [],
          permissions: (role.permissions || []),
        },
        reason: `Intent role "${role.name}" missing in auth schema`,
      });
    }
  });

  return patches;
}

function generateBusinessLogicPatches(schemas, appSpec) {
  const patches = [];
  if (!appSpec?.features) return patches;

  // Payments feature → pricing page + payment endpoint
  if (appSpec.features.payments) {
    const hasPricing = schemas.ui?.pages?.some(p => /pric|checkout/i.test(p.name));
    if (!hasPricing) {
      patches.push({
        operation: 'add_to_array',
        layer: 'ui',
        arrayPath: 'pages',
        value: {
          name: 'Pricing',
          route: '/pricing',
          title: 'Pricing Plans',
          layout: 'minimal',
          sections: [{
            id: 'pricing_plans',
            type: 'list',
            title: 'Choose a Plan',
            fields: [],
            actions: [{ label: 'Upgrade', type: 'link', target: '/checkout' }],
          }],
        },
        reason: 'Payments feature requires pricing page',
      });
    }

    const hasPaymentEp = schemas.api?.endpoints?.some(ep => /payment|subscription/i.test(ep.path));
    if (!hasPaymentEp) {
      patches.push({
        operation: 'add_to_array',
        layer: 'api',
        arrayPath: 'endpoints',
        value: {
          id: 'create_subscription',
          group: 'Payments',
          method: 'POST',
          path: '/api/v1/subscriptions',
          description: 'Create subscription',
          auth: true,
          roles: ['user'],
          requestBody: { type: 'object', required: ['planId'], properties: { planId: { type: 'string' } } },
          responses: { '200': { description: 'Subscription created' }, '402': { description: 'Payment failed' } },
          queryParams: [],
          rateLimited: true,
          premiumOnly: false,
        },
        reason: 'Payments feature requires subscription endpoint',
      });
    }
  }

  return patches;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveTarget(schemas, layer, path) {
  if (!path) return null;
  const parts = path.split('.');
  let obj = schemas[layer];
  if (!obj) return null;

  for (let i = 0; i < parts.length - 1; i++) {
    const match = parts[i].match(/(\w+)\[(\d+)\]/) || parts[i].match(/(\w+)\.(\d+)/);
    if (match) {
      obj = obj[match[1]]?.[parseInt(match[2])];
    } else {
      obj = obj[parts[i]];
    }
    if (obj == null) return null;
  }

  const lastKey = parts[parts.length - 1];
  return { obj, key: lastKey };
}

function getDefault(path) {
  if (path.endsWith('pages') || path.endsWith('endpoints') || path.endsWith('tables') || path.endsWith('roles')) return [];
  if (path.endsWith('mode')) return 'light';
  if (path.endsWith('type')) return 'jwt';
  return null;
}

function mapToValidDBType(type) {
  if (!type) return 'VARCHAR';
  const upper = type.toUpperCase();
  const valid = ['UUID','VARCHAR','TEXT','INTEGER','BIGINT','BOOLEAN','TIMESTAMP','DECIMAL','JSONB','ENUM','FLOAT','DATE','SERIAL'];
  if (valid.includes(upper)) return upper;
  const map = { STRING: 'VARCHAR', INT: 'INTEGER', BOOL: 'BOOLEAN', DATETIME: 'TIMESTAMP', JSON: 'JSONB', DOUBLE: 'DECIMAL' };
  return map[upper] || 'VARCHAR';
}

function buildUsersTable() {
  return {
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
  };
}

function buildAuthEndpoints() {
  return [
    { id: 'auth_login', group: 'Auth', method: 'POST', path: '/api/v1/auth/login', description: 'Login', auth: false, roles: [], requestBody: { properties: { email: { type: 'string' }, password: { type: 'string' } } }, responses: { '200': { description: 'JWT token' }, '401': { description: 'Invalid credentials' } }, queryParams: [], rateLimited: true, premiumOnly: false },
    { id: 'auth_register', group: 'Auth', method: 'POST', path: '/api/v1/auth/register', description: 'Register', auth: false, roles: [], requestBody: { properties: { email: { type: 'string' }, password: { type: 'string' } } }, responses: { '201': { description: 'User created' }, '409': { description: 'Email exists' } }, queryParams: [], rateLimited: true, premiumOnly: false },
    { id: 'auth_me', group: 'Auth', method: 'GET', path: '/api/v1/auth/me', description: 'Current user', auth: true, roles: [], requestBody: {}, responses: { '200': { description: 'User profile' } }, queryParams: [], rateLimited: false, premiumOnly: false },
    { id: 'auth_logout', group: 'Auth', method: 'POST', path: '/api/v1/auth/logout', description: 'Logout', auth: true, roles: [], requestBody: {}, responses: { '200': { description: 'Logged out' } }, queryParams: [], rateLimited: false, premiumOnly: false },
  ];
}
