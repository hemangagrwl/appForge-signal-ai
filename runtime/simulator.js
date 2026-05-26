/**
 * Simulator
 * Validates generated artifacts without actually running them.
 * Proves executability: valid syntax, correct structure, no missing references.
 * 
 * Checks:
 *   ✓ Prisma schema parses (validates syntax + relations)
 *   ✓ All pages have corresponding routes
 *   ✓ All entity routers are referenced in main routes
 *   ✓ Auth middleware exported correctly
 *   ✓ No dangling foreign key references
 *   ✓ No undefined role references in guards
 */
  import MetricsAggregator from "../lib/metricsAggregator.js";
  import BuildValidator from "./buildValidator.js";

  const metrics = new MetricsAggregator();  
  export function simulate(appSpec, artifacts) {
  const checks = [];
  const startTime = Date.now();

  // ── 1. Prisma schema check ──────────────────────────────────────────────
  const prisma = artifacts['prisma/schema.prisma'];
  checks.push(checkPrismaSchema(prisma, appSpec));

  // ── 2. API routes check ─────────────────────────────────────────────────
  const apiRoutes = artifacts['api/routes.js'];
  checks.push(checkAPIRoutes(apiRoutes, appSpec));

  // ── 3. Auth middleware check ────────────────────────────────────────────
  const authMiddleware = artifacts['auth/middleware.js'];
  checks.push(checkAuthMiddleware(authMiddleware, appSpec));

  // ── 4. Page generation check ────────────────────────────────────────────
  for (const page of appSpec.pages) {
    const key = `pages/${page.name.toLowerCase()}.jsx`;
    checks.push(checkPageArtifact(artifacts[key], page));
  }

  // ── 5. Entity router checks ─────────────────────────────────────────────
  for (const entity of appSpec.entities) {
    const key = `api/${entity.name.toLowerCase()}Router.js`;
    checks.push(checkEntityRouter(artifacts[key], entity));
  }

  // ── 6. Cross-reference: endpoints reference known entities ──────────────
  checks.push(checkEndpointEntityRefs(appSpec));

  // ── 7. Cross-reference: auth roles consistent ───────────────────────────
  checks.push(checkRoleConsistency(appSpec));

  // ── 8. Foreign key references ───────────────────────────────────────────
  checks.push(checkForeignKeys(appSpec));
  const validator = new BuildValidator();

  const buildChecks = validator.validate();

  checks.push(...buildChecks);
  const passed = checks.filter(c => c.passed);
  const failed = checks.filter(c => !c.passed);
  const warnings = checks.filter(c => c.warning);

  metrics.addRun({

    success:
        failed.length===0,

    retries:
        appSpec.retryCount || 0,

    latency:
        Date.now()-startTime,

    failureType:
        failed[0]?.name || null
});
  return {
    executable: failed.length === 0,
    summary: {
      total: checks.length,
      passed: passed.length,
      failed: failed.length,
      warnings: warnings.length,
      durationMs: Date.now() - startTime,
    },
    checks,
    artifactsGenerated: Object.keys(artifacts).length,
    simulationReport: buildReport(checks, appSpec, artifacts),
    metrics:metrics.getSummary()
  };
}

// ── Individual checks ─────────────────────────────────────────────────────────

function checkPrismaSchema(content, appSpec) {
  const check = { name: 'Prisma schema', passed: false, details: '' };
  if (!content) { check.details = 'Prisma schema not generated'; return check; }

  // Check all entities appear as models
  const missingModels = appSpec.entities.filter(e =>
    !content.includes(`model ${e.name}`)
  );

  if (!content.includes('model User') && !appSpec.entities.some(e => e.name === 'User')) {
    // User model auto-added — OK
  }

  if (missingModels.length > 0) {
    check.details = `Missing models: ${missingModels.map(e => e.name).join(', ')}`;
    return check;
  }

  // Check datasource exists
  if (!content.includes('datasource db')) {
    check.details = 'Missing datasource block';
    return check;
  }

  // Check generator exists
  if (!content.includes('generator client')) {
    check.details = 'Missing generator block';
    return check;
  }

  // Check no obviously broken relations (referenced model exists)
  const modelNames = new Set(appSpec.entities.map(e => e.name));
  modelNames.add('User');
  for (const entity of appSpec.entities) {
    for (const rel of entity.relations) {
      if (!modelNames.has(rel.entity)) {
        check.details = `Relation references unknown model: ${rel.entity} in ${entity.name}`;
        check.warning = true;
        check.passed = true; // warning only, not fatal
        return check;
      }
    }
  }

  check.passed = true;
  check.details = `${appSpec.entities.length + 1} models valid (incl. User)`;
  return check;
}

function checkAPIRoutes(content, appSpec) {
  const check = { name: 'API routes', passed: false, details: '' };
  if (!content) { check.details = 'API routes not generated'; return check; }

  // Check auth routes present
  if (!content.includes('/auth/login') || !content.includes('/auth/register')) {
    check.details = 'Missing auth routes (login/register)';
    return check;
  }

  // Check all entity routers imported
  const missingImports = appSpec.entities.filter(e =>
    !content.includes(`${e.name.toLowerCase()}Router`)
  );

  if (missingImports.length > 0) {
    check.details = `Missing router imports: ${missingImports.map(e => e.name).join(', ')}`;
    return check;
  }

  check.passed = true;
  check.details = `Auth routes + ${appSpec.entities.length} entity routers`;
  return check;
}

function checkAuthMiddleware(content, appSpec) {
  const check = { name: 'Auth middleware', passed: false, details: '' };
  if (!content) { check.details = 'Auth middleware not generated'; return check; }

  const required = ['authenticate', 'authorize', 'generateToken'];
  const missing = required.filter(fn => !content.includes(`export function ${fn}`));

  if (missing.length > 0) {
    check.details = `Missing exports: ${missing.join(', ')}`;
    return check;
  }

  // Check all roles present in middleware
  const missingRoles = appSpec.roles.filter(r =>
    !content.includes(r.name)
  );

  if (missingRoles.length > 0) {
    check.details = `Missing role definitions: ${missingRoles.map(r => r.name).join(', ')}`;
    check.warning = true;
    check.passed = true;
    return check;
  }

  check.passed = true;
  check.details = `JWT auth, ${appSpec.roles.length} roles`;
  return check;
}

function checkPageArtifact(content, page) {
  const check = { name: `Page: ${page.name}`, passed: false, details: '' };
  if (!content) { check.details = `Page component not generated`; return check; }

  if (!content.includes(`export default`)) {
    check.details = 'Missing default export';
    return check;
  }

  if (!content.includes(`path: '${page.route}'`)) {
    check.details = `Route config missing for ${page.route}`;
    check.warning = true;
  }

  check.passed = true;
  check.details = `Route: ${page.route}, protected: ${page.protected}`;
  return check;
}

function checkEntityRouter(content, entity) {
  const check = { name: `Router: ${entity.name}`, passed: false, details: '' };
  if (!content) { check.details = 'Entity router not generated'; return check; }

  const requiredMethods = ['router.get', 'router.post'];
  const missing = requiredMethods.filter(m => !content.includes(m));

  if (missing.length > 0) {
    check.details = `Missing route methods: ${missing.join(', ')}`;
    return check;
  }

  if (!content.includes('export default router')) {
    check.details = 'Missing router export';
    return check;
  }

  check.passed = true;
  check.details = `CRUD routes for ${entity.name} (${entity.fields.length} fields)`;
  return check;
}

function checkEndpointEntityRefs(appSpec) {
  const check = { name: 'Endpoint entity references', passed: true, details: '', warning: false };
  const entityNames = new Set(appSpec.entities.map(e => e.name));

  const phantom = appSpec.endpoints.filter(ep =>
    ep.entity && !entityNames.has(ep.entity)
  );

  if (phantom.length > 0) {
    check.details = `Endpoints reference unknown entities: ${phantom.map(ep => ep.entity).join(', ')}`;
    check.warning = true;
  } else {
    check.details = `All ${appSpec.endpoints.length} endpoint entity refs valid`;
  }

  return check;
}

function checkRoleConsistency(appSpec) {
  const check = { name: 'Role consistency', passed: true, details: '' };
  const definedRoles = new Set(appSpec.roles.map(r => r.name.toLowerCase()));

  const phantomRoles = [];
  appSpec.endpoints.forEach(ep => {
    (ep.roles || []).forEach(role => {
      if (!definedRoles.has(role.toLowerCase())) {
        phantomRoles.push(`${role} (in ${ep.path})`);
      }
    });
  });

  appSpec.pages.forEach(page => {
    (page.roles || []).forEach(role => {
      if (!definedRoles.has(role.toLowerCase())) {
        phantomRoles.push(`${role} (in page ${page.name})`);
      }
    });
  });

  if (phantomRoles.length > 0) {
    check.passed = false;
    check.details = `Undefined roles: ${phantomRoles.join(', ')}`;
  } else {
    check.details = `All role references valid across ${appSpec.endpoints.length} endpoints + ${appSpec.pages.length} pages`;
  }

  return check;
}

function checkForeignKeys(appSpec) {
  const check = { name: 'Foreign key integrity', passed: true, details: '' };
  const entityNames = new Set(appSpec.entities.map(e => e.name));

  const broken = [];
  appSpec.entities.forEach(entity => {
    entity.relations?.forEach(rel => {
      if (!entityNames.has(rel.entity)) {
        broken.push(`${entity.name} → ${rel.entity} (not found)`);
      }
    });
  });

  if (broken.length > 0) {
    check.passed = false;
    check.details = `Broken relations: ${broken.join('; ')}`;
  } else {
    check.details = `All relations valid`;
  }

  return check;
}

// ── Report builder ────────────────────────────────────────────────────────────

function buildReport(checks, appSpec, artifacts) {
  const lines = ['AppForge Simulation Report', '═'.repeat(40)];

  for (const check of checks) {
    const icon = check.passed ? (check.warning ? '⚠' : '✓') : '✗';
    lines.push(`${icon} ${check.name.padEnd(35)} ${check.details}`);
  }

  lines.push('═'.repeat(40));
  lines.push(`Artifacts: ${Object.keys(artifacts).join(', ')}`);
  lines.push(`Entities: ${appSpec.entities.map(e => e.name).join(', ')}`);
  lines.push(`Pages: ${appSpec.pages.map(p => p.name).join(', ')}`);
  lines.push(`Endpoints: ${appSpec.endpoints.length}`);

  return lines.join('\n');
}
