/**
 * Stage 3: Schema Generation (v2 — IR-driven)
 * 
 * ALL generators now consume the AppSpec IR, not raw intent.
 * This guarantees cross-layer consistency because every layer
 * is generated from the same canonical data structure.
 */

import { callClaude } from '../utils/claude_client.js';
import { safeParseJSON } from '../utils/json_utils.js';
import {
  buildMinimalUISchema,
  buildMinimalAPISchema,
  buildMinimalDBSchema,
  buildMinimalAuthSchema
} from '../validation/validator.js';
const UI_PROMPT = `You are a frontend architect. Generate a UI schema from the AppSpec IR. Return ONLY valid JSON. No markdown.

Return:
{
  "theme": { "primaryColor": "#hex", "fontFamily": "name", "mode": "light|dark" },
  "components": ["component names"],
  "pages": [
    {
      "name": "string",
      "route": "/path",
      "title": "string",
      "layout": "default|auth|minimal|dashboard|public",
      "sections": [
        {
          "id": "string",
          "type": "hero|table|form|stats|chart|list|detail",
          "title": "string",
          "entity": "EntityName",
          "fields": [{ "name": "f", "label": "L", "type": "text|email|password|select|number|textarea", "required": true, "options": [] }],
          "actions": [{ "label": "L", "type": "submit|link|delete", "target": "/route" }]
        }
      ]
    }
  ]
}`;

const API_PROMPT = `You are a backend architect. Generate an API schema from the AppSpec IR. Return ONLY valid JSON. No markdown.

Return:
{
  "version": "1.0.0",
  "baseUrl": "/api/v1",
  "auth": { "type": "jwt|session", "headerName": "Authorization", "prefix": "Bearer" },
  "endpoints": [
    {
      "id": "string",
      "group": "string",
      "method": "GET|POST|PUT|DELETE|PATCH",
      "path": "/path/:id",
      "description": "string",
      "auth": true,
      "roles": [],
      "requestBody": { "type": "object", "required": [], "properties": {} },
      "responses": { "200": { "description": "OK" } },
      "queryParams": [],
      "rateLimited": false,
      "premiumOnly": false
    }
  ]
}`;

const DB_PROMPT = `You are a database architect. Generate a DB schema from the AppSpec IR. Return ONLY valid JSON. No markdown.

IMPORTANT: Every table MUST have an id column as primary key.
Valid column types: UUID, VARCHAR, TEXT, INTEGER, BIGINT, BOOLEAN, TIMESTAMP, DECIMAL, JSONB, ENUM, FLOAT, DATE

Return:
{
  "dialect": "postgresql",
  "tables": [
    {
      "name": "table_name",
      "description": "string",
      "columns": [
        { "name": "id", "type": "UUID", "primaryKey": true, "nullable": false, "unique": true, "default": "gen_random_uuid()", "enumValues": [] }
      ],
      "indexes": [{ "name": "idx_name", "columns": ["col"], "unique": false }]
    }
  ],
  "migrations": [{ "id": "001", "description": "Initial schema", "tables": [] }]
}`;

const AUTH_PROMPT = `You are a security architect. Generate an auth schema from the AppSpec IR. Return ONLY valid JSON. No markdown.

Return:
{
  "strategy": "jwt|session",
  "jwtConfig": { "expiry": "7d", "refreshExpiry": "30d", "algorithm": "HS256" },
  "roles": [
    {
      "name": "string",
      "description": "string",
      "inherits": [],
      "permissions": [{ "resource": "string", "actions": ["create","read","update","delete"], "conditions": [] }]
    }
  ],
  "guards": [{ "name": "string", "type": "route|api", "target": "/path", "requires": { "auth": true, "roles": [] } }],
  "passwordPolicy": { "minLength": 8, "requireUppercase": true, "requireNumber": true },
  "socialAuth": []
}`;

export async function generateSchemas(appSpec) {
  // Build a minimal context from AppSpec IR for each layer
  const baseContext = {
    appName: appSpec.metadata.appName,
    appType: appSpec.metadata.appType,
    entities: appSpec.entities.map(e => ({
      name: e.name,
      tableName: e.tableName,
      fields: e.fields,
      relations: e.relations,
    })),
    roles: appSpec.roles.map(r => ({ name: r.name, permissions: r.permissions })),
    features: appSpec.features,
    auth: appSpec.auth,
  };

  // All 4 in parallel — same IR feeds all
  const [uiRaw, apiRaw, dbRaw, authRaw] = await Promise.all([
    genLayer(UI_PROMPT, { ...baseContext, pages: appSpec.pages, endpoints: appSpec.endpoints }, 'UI'),
    genLayer(API_PROMPT, { ...baseContext, endpoints: appSpec.endpoints, businessRules: appSpec.businessRules }, 'API'),
    genLayer(DB_PROMPT, { ...baseContext, entities: appSpec.entities }, 'DB'),
    genLayer(AUTH_PROMPT, { ...baseContext, roles: appSpec.roles }, 'Auth'),
  ]);

  return {

    ui:
      uiRaw?.pages
      ? uiRaw
      : buildMinimalUISchema(appSpec),

    api:
      apiRaw?.endpoints
      ? apiRaw
      : buildMinimalAPISchema(appSpec),

    db:
      dbRaw?.tables
      ? dbRaw
      : buildMinimalDBSchema(appSpec),

    auth:
      authRaw?.strategy
      ? authRaw
      : buildMinimalAuthSchema(appSpec)

};
}

async function genLayer(systemPrompt, context, label) {
  const response = await callClaude({
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Generate ${label} schema for this AppSpec:\n\n${JSON.stringify(context, null, 2)}\n\nReturn ONLY valid JSON.`
    }],
    temperature: 0.1,
    max_tokens: 4000,
  });
  return safeParseJSON(response, `Stage3:${label}`);
}
