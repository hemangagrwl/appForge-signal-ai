/**
 * Stage 6: Evaluation Framework
 * Scores output quality across multiple dimensions.
 * Tracks metrics for comparison across runs.
 */

export function evaluateOutput(schemas, intent, systemDesign, metrics) {
  const checks = {
    completeness: scoreCompleteness(schemas, intent),
    consistency: scoreConsistency(schemas),
    coverage: scoreCoverage(schemas, intent),
    executability: scoreExecutability(schemas),
    security: scoreSecurity(schemas, intent),
  };

  const weights = { completeness: 0.3, consistency: 0.25, coverage: 0.2, executability: 0.15, security: 0.1 };
  const score = Object.entries(weights).reduce((sum, [k, w]) => sum + (checks[k].score * w), 0);

  const warnings = Object.entries(checks)
    .flatMap(([dimension, result]) => result.warnings.map(w => `[${dimension}] ${w}`));

  return {
    score: Math.round(score * 100) / 100,
    grade: scoreToGrade(score),
    checks,
    warnings,
    summary: buildSummary(schemas, intent, score),
    retries: metrics.totalRetries,
    latencyMs: Date.now() - metrics.startTime,
  };
}

function scoreCompleteness(schemas, intent) {
  const warnings = [];
  let points = 0;
  const max = 10;

  if (schemas.ui?.pages?.length > 0) points += 2; else warnings.push('UI pages missing');
  if (schemas.api?.endpoints?.length > 0) points += 2; else warnings.push('API endpoints missing');
  if (schemas.db?.tables?.length > 0) points += 2; else warnings.push('DB tables missing');
  if (schemas.auth?.roles?.length > 0) points += 2; else warnings.push('Auth roles missing');
  
  // Check all intent entities have a DB table
  const tableNames = new Set(
    (schemas.db?.tables || [])
    .map(t => (t?.name || '').toLowerCase())
);
  intent.entities.forEach(e => {
    const name = (e?.name || '').toLowerCase();
    if (tableNames.has(name) || tableNames.has(name + 's')) points += 0.5;
    else warnings.push(`Entity "${e.name}" has no DB table`);
  });

  // Check all intent pages have a UI page
  const pageNames = new Set(
    (schemas.ui?.pages || [])
    .map(p => (p?.name || '').toLowerCase())
);
  intent.pages.forEach(p => {

    const pageName =
        typeof p === 'string'
        ? p
        : (p?.name || '');

    if(
        pageNames.has(
            pageName.toLowerCase()
        )
    ){
        points += 0.5;
    }

});

  return { score: Math.min(points / max, 1), warnings };
}

function scoreConsistency(schemas) {
  const warnings = [];
  let issues = 0;

  // Check auth roles referenced in API exist in auth schema
  const authRoles = new Set(
    (schemas.auth?.roles || [])
    .map(r => (r?.name || '').toLowerCase())
);
  (schemas.api?.endpoints || []).forEach(ep => {
    (ep.roles || []).forEach(role => {
      if (!authRoles.has((role || '').toLowerCase())) {
        issues++;
        warnings.push(`Role "${role}" in endpoint "${ep.path}" not defined in auth`);
      }
    });
  });

  // Check DB tables have primary keys
  (schemas.db?.tables || []).forEach(t => {
    if (!t.columns?.some(c => c.primaryKey)) {
      issues++;
      warnings.push(`Table "${t.name}" missing primary key`);
    }
  });

  const score = Math.max(0, 1 - (issues * 0.15));
  return { score, warnings };
}

function scoreCoverage(schemas, intent) {
  const warnings = [];
  let covered = 0;
  const total = intent.coreFeatures.length || 1;

  // Simple heuristic: check if keywords from features appear in schema
  intent.coreFeatures.forEach(feature => {
    const keywords =
    (feature || '')
    .toLowerCase()
    .split(/\s+/);
    const allSchemaText = JSON.stringify(schemas).toLowerCase();
    const matched = keywords.some(kw => kw.length > 3 && allSchemaText.includes(kw));
    if (matched) covered++;
    else warnings.push(`Feature "${feature}" may not be covered`);
  });

  return { score: covered / total, warnings };
}

function scoreExecutability(schemas) {
  const warnings = [];
  let score = 1.0;

  // Check every API endpoint has a valid method
  const validMethods = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
  (schemas.api?.endpoints || []).forEach(ep => {
    if (!validMethods.has(ep.method)) {
      score -= 0.1;
      warnings.push(`Invalid HTTP method "${ep.method}" on ${ep.path}`);
    }
    if (!ep.path?.startsWith('/')) {
      score -= 0.05;
      warnings.push(`Endpoint path "${ep.path}" should start with /`);
    }
  });

  // Check DB columns have valid types
  const validTypes = new Set(['UUID','VARCHAR','TEXT','INTEGER','BIGINT','BOOLEAN','TIMESTAMP','DECIMAL','JSONB','ENUM','FLOAT','DATE']);
  (schemas.db?.tables || []).forEach(t => {
    (t.columns || []).forEach(c => {
      if (!validTypes.has(c.type?.toUpperCase())) {
        score -= 0.05;
        warnings.push(`Unknown column type "${c.type}" in ${t.name}.${c.name}`);
      }
    });
  });

  return { score: Math.max(0, score), warnings };
}

function scoreSecurity(schemas, intent) {
  const warnings = [];
  let score = 1.0;

  if (!intent.authRequired) return { score: 1, warnings: [] };

  // Check protected endpoints have auth=true
  const sensitivePatterns = [/create|update|delete|admin|payment|password/i];
  (schemas.api?.endpoints || []).forEach(ep => {
    const isSensitive = sensitivePatterns.some(p => p.test(ep.path) || p.test(ep.description || ''));
    if (isSensitive && ep.auth === false) {
      score -= 0.2;
      warnings.push(`Sensitive endpoint "${ep.path}" has auth=false`);
    }
  });

  // Check password fields are not in response schemas
  (schemas.api?.endpoints || []).forEach(ep => {
    const responseText = JSON.stringify(ep.responses || {}).toLowerCase();
    if (responseText.includes('password') && !responseText.includes('hash')) {
      score -= 0.1;
      warnings.push(`Endpoint "${ep.path}" may expose password in response`);
    }
  });

  return { score: Math.max(0, score), warnings };
}

function scoreToGrade(score) {
  if (score >= 0.9) return 'A';
  if (score >= 0.8) return 'B';
  if (score >= 0.7) return 'C';
  if (score >= 0.6) return 'D';
  return 'F';
}

function buildSummary(schemas, intent, score) {
  return {
    pagesGenerated: schemas.ui?.pages?.length || 0,
    endpointsGenerated: schemas.api?.endpoints?.length || 0,
    tablesGenerated: schemas.db?.tables?.length || 0,
    rolesGenerated: schemas.auth?.roles?.length || 0,
    entitiesCovered: intent.entities.length,
    featuresCovered: intent.coreFeatures.length,
    qualityScore: `${(score * 100).toFixed(0)}%`,
  };
}

// ── BENCHMARK DATASET ────────────────────────────────────────────────────────
export const EVAL_DATASET = {
  realPrompts: [
    "Build a CRM with login, contacts, dashboard, role-based access, and premium plan with payments. Admins can see analytics.",
    "Create an e-commerce platform with product listings, shopping cart, checkout, order tracking, and seller dashboard.",
    "Build a project management tool like Trello with boards, cards, lists, team collaboration, and deadline reminders.",
    "Create a blog platform with post editor, comments, categories, tags, and author profiles.",
    "Build an HR system with employee directory, leave management, payroll reports, and department hierarchy.",
    "Create a learning management system with courses, quizzes, progress tracking, certificates, and instructor dashboard.",
    "Build a real estate listing platform with property search, filters, favorites, agent contact, and mortgage calculator.",
    "Create a healthcare appointment system with doctor profiles, booking, reminders, medical history, and billing.",
    "Build a restaurant management system with menu, online ordering, table reservations, and inventory tracking.",
    "Create a freelance marketplace with job listings, proposals, contracts, payments, and reviews.",
  ],
  edgeCases: [
    // Vague
    "Build an app",
    "Make something for my business",
    // Conflicting
    "Build a free app with premium features that everyone can access without paying but also has paid tiers",
    "Create a private social network that's also completely public and anonymous but also has user profiles",
    // Incomplete
    "CRM with contacts",
    "Dashboard with charts",
    // Over-specified
    "Build a SaaS app with microservices, kubernetes, GraphQL, Redis caching, event sourcing, CQRS, WebSocket real-time updates, multi-tenant with row-level security, white-label theming, i18n for 20 languages, SOC2 compliance, GDPR tools, A/B testing, feature flags, and ML-based recommendation engine.",
    // Ambiguous roles
    "Build a marketplace where buyers and sellers can both post listings and both can be admins sometimes",
    // Tech-specific but vague on features
    "Build a Next.js app with Supabase",
    // Mixed languages
    "Build a todo app pero con social features y collaboration en tiempo real",
  ],
};
