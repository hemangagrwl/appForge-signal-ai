/**
 * Stage 2: System Design
 * Converts IntentObject → full ArchitectureBlueprint
 * Defines: navigation flows, API groups, data flows, business logic rules
 */

import { callClaude } from '../utils/claude_client.js';
import { safeParseJSON } from '../utils/json_utils.js';

const SYSTEM_DESIGN_PROMPT = `You are a senior software architect.
Given a structured app intent, produce a complete architectural blueprint in strict JSON.
No markdown. No explanation. Return ONLY valid JSON.

Return this exact structure:
{
  "architecture": "spa|ssr|api-first|monolith",
  "techStack": {
    "frontend": "react|vue|html",
    "backend": "node-express|fastapi|none",
    "database": "postgresql|sqlite|mongodb",
    "auth": "jwt|session|oauth"
  },
  "navigationFlow": [
    { "page": "PageName", "route": "/path", "protected": true, "roles": ["roleName"], "layout": "default|auth|minimal" }
  ],
  "apiGroups": [
    {
      "group": "GroupName",
      "prefix": "/api/v1/resource",
      "endpoints": [
        {
          "method": "GET|POST|PUT|DELETE|PATCH",
          "path": "/path/:param",
          "description": "what this does",
          "auth": true,
          "roles": ["roleName"],
          "requestBody": { "field": "type" },
          "responseShape": { "field": "type" },
          "queryParams": ["param1", "param2"]
        }
      ]
    }
  ],
  "businessRules": [
    { "id": "rule_id", "description": "business rule", "trigger": "when", "action": "what happens", "entities": ["Entity"] }
  ],
  "dataFlows": [
    { "name": "flow name", "steps": ["step1", "step2"] }
  ],
  "premiumFeatures": [],
  "analytics": {
    "required": false,
    "metrics": []
  }
}`;

export async function designSystem(intent) {
  const intentSummary = JSON.stringify({
    appType: intent.appType,
    coreFeatures: intent.coreFeatures,
    entities: intent.entities.map(e => ({ name: e.name, fields: e.fields.map(f => f.name) })),
    roles: intent.roles.map(r => r.name),
    authRequired: intent.authRequired,
    paymentRequired: intent.paymentRequired,
    pages: intent.pages,
  }, null, 2);

  const response = await callClaude({
    system: SYSTEM_DESIGN_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Design the system architecture for this app:\n\n${intentSummary}\n\nReturn ONLY valid JSON architecture blueprint.`
      }
    ],
    temperature: 0.1,
    max_tokens: 4000,
  });

  const design = safeParseJSON(response, 'Stage2:SystemDesign');
  return normalizeDesign(design, intent);
}

function normalizeDesign(design, intent) {
  const techStack = design.techStack || {};
  
  return {
    architecture: design.architecture || 'spa',
    techStack: {
      frontend: techStack.frontend || 'react',
      backend: techStack.backend || 'node-express',
      database: techStack.database || 'postgresql',
      auth: techStack.auth || 'jwt',
    },
    navigationFlow: ensureArray(design.navigationFlow).map(n => ({
      page: n.page || 'Page',
      route: n.route || '/',
      protected: n.protected !== false,
      roles: ensureArray(n.roles),
      layout: n.layout || 'default',
    })),
    apiGroups: ensureArray(design.apiGroups).map(g => ({
      group: g.group || 'General',
      prefix: g.prefix || '/api/v1',
      endpoints: ensureArray(g.endpoints).map(normalizeEndpoint),
    })),
    businessRules: ensureArray(design.businessRules),
    dataFlows: ensureArray(design.dataFlows),
    premiumFeatures: ensureArray(design.premiumFeatures),
    analytics: design.analytics || { required: false, metrics: [] },
  };
}

function normalizeEndpoint(ep) {
  return {
    method: (ep.method || 'GET').toUpperCase(),
    path: ep.path || '/',
    description: ep.description || '',
    auth: ep.auth !== false,
    roles: ensureArray(ep.roles),
    requestBody: ep.requestBody || {},
    responseShape: ep.responseShape || {},
    queryParams: ensureArray(ep.queryParams),
  };
}

function ensureArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  return [];
}
