/**
 * Stage 1: Intent Extraction
 * Converts raw natural language → structured IntentObject
 * Identifies: app type, features, entities, roles, constraints, ambiguities
 */

import { callClaude } from '../utils/claude_client.js';
import { safeParseJSON } from '../utils/json_utils.js';

const INTENT_SYSTEM_PROMPT = `You are an expert software architect and product analyst.
Your job is to parse a user's app description into a STRICT structured JSON format.
You MUST always return valid JSON — nothing else. No markdown, no explanation, no backticks.

Return this exact structure:
{
  "appName": "string — inferred app name",
  "appType": "one of: crm | ecommerce | saas | blog | dashboard | marketplace | social | tool | other",
  "description": "1-2 sentence summary of what this app does",
  "coreFeatures": ["array of concrete feature strings"],
  "entities": [
    {
      "name": "string — PascalCase entity name",
      "description": "what this entity represents",
      "fields": [
        { "name": "fieldName", "type": "string|number|boolean|date|email|enum|uuid|text|json", "required": true, "unique": false, "enumValues": [] }
      ],
      "relations": [
        { "type": "hasMany|belongsTo|hasOne|manyToMany", "entity": "OtherEntity", "via": "optional join table" }
      ]
    }
  ],
  "roles": [
    { "name": "roleName", "description": "what this role can do", "permissions": ["resource:action"] }
  ],
  "authRequired": true,
  "paymentRequired": false,
  "pages": ["array of page names like: Login, Dashboard, Contacts, Settings"],
  "assumptions": ["list any assumptions you made for unclear requirements"],
  "ambiguities": ["list things that were unclear or conflicting"],
  "clarificationNeeded": false
}`;

export async function extractIntent(userPrompt) {
  if (!userPrompt || userPrompt.trim().length < 10) {
    throw new Error('Prompt too short or empty');
  }

  const response = await callClaude({
    system: INTENT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Parse this app description into the required JSON format:\n\n"${userPrompt.trim()}"\n\nReturn ONLY valid JSON. No explanation.`
      }
    ],
    temperature: 0.1, // low temp for determinism
    max_tokens: 3000,
  });

  const intent = safeParseJSON(response, 'Stage1:IntentExtraction');
  
  // Enforce required fields with defaults
  return normalizeIntent(intent, userPrompt);
}

function normalizeIntent(intent, originalPrompt) {
  return {
    appName: intent.appName || inferAppName(originalPrompt),
    appType: intent.appType || 'tool',
    description: intent.description || originalPrompt.slice(0, 200),
    coreFeatures: ensureArray(intent.coreFeatures),
    entities: ensureArray(intent.entities).map(normalizeEntity),
    roles: ensureArray(intent.roles).length > 0 
      ? ensureArray(intent.roles) 
      : [{ name: 'user', description: 'Regular user', permissions: ['*:read'] }],
    authRequired: intent.authRequired !== false,
    paymentRequired: !!intent.paymentRequired,
    pages: ensureArray(intent.pages).length > 0 ? intent.pages : inferPages(intent),
    assumptions: ensureArray(intent.assumptions),
    ambiguities: ensureArray(intent.ambiguities),
    clarificationNeeded: !!intent.clarificationNeeded,
    originalPrompt,
  };
}

function normalizeEntity(entity) {
  if (!entity || typeof entity !== 'object') return null;
  return {
    name: entity.name || 'Unknown',
    description: entity.description || '',
    fields: ensureArray(entity.fields).map(f => ({
      name: f.name || 'field',
      type: f.type || 'string',
      required: f.required !== false,
      unique: !!f.unique,
      enumValues: ensureArray(f.enumValues),
    })),
    relations: ensureArray(entity.relations),
  };
}

function inferAppName(prompt) {
  const words = prompt.split(' ').slice(0, 4).join(' ');
  return words.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'MyApp';
}

function inferPages(intent) {
  const pages = [];
  if (intent.authRequired) pages.push('Login', 'Register');
  pages.push('Dashboard');
  (intent.entities || []).forEach(e => {
    if (e && e.name) {
      pages.push(`${e.name}List`, `${e.name}Detail`);
    }
  });
  if (intent.paymentRequired) pages.push('Pricing', 'Checkout');
  pages.push('Settings');
  return pages;
}

function ensureArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  return [];
}
