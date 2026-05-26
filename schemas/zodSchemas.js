/**
 * Zod Schema Validators
 * Replaces manual if(!schemas.ui.pages) checks with typed, deterministic validation.
 * Each validator returns { success, data, issues } so the repair engine
 * can act on strongly-typed ZodIssue objects rather than ad-hoc strings.
 */

import { z } from 'zod';

// ── UI Schema ────────────────────────────────────────────────────────────────

export const UIFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text','email','password','select','checkbox','radio','date','number','textarea','file','hidden']),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  options: z.array(z.string()).default([]),
});

export const UISectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['hero','table','form','stats','chart','list','detail','modal','sidebar','empty']),
  title: z.string().optional(),
  fields: z.array(UIFieldSchema).default([]),
  actions: z.array(z.object({
    label: z.string(),
    type: z.enum(['submit','link','modal','delete','api']),
    target: z.string(),
  })).default([]),
});

export const UIPageSchema = z.object({
  name: z.string().min(1),
  route: z.string().startsWith('/'),
  title: z.string().min(1),
  layout: z.enum(['default','auth','minimal','dashboard','public']).default('default'),
  sections: z.array(UISectionSchema).default([]),
});

export const UISchemaValidator = z.object({
  theme: z.object({
    primaryColor: z.string(),
    fontFamily: z.string(),
    mode: z.enum(['light','dark']),
  }).default({ primaryColor: '#6366f1', fontFamily: 'Inter', mode: 'light' }),
  components: z.array(z.string()).default([]),
  pages: z.array(UIPageSchema).min(1, 'At least one page required'),
});

// ── API Schema ───────────────────────────────────────────────────────────────

export const APIEndpointValidator = z.object({
  id: z.string().min(1),
  group: z.string().min(1),
  method: z.enum(['GET','POST','PUT','DELETE','PATCH'], {
    errorMap: () => ({ message: 'method must be GET, POST, PUT, DELETE, or PATCH' }),
  }),
  path: z.string().startsWith('/'),
  description: z.string().default(''),
  auth: z.boolean().default(true),
  roles: z.array(z.string()).default([]),
  requestBody: z.record(z.any()).default({}),
  responses: z.record(z.any()).default({}),
  queryParams: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean().default(false),
  })).default([]),
  rateLimited: z.boolean().default(false),
  premiumOnly: z.boolean().default(false),
});

export const APISchemaValidator = z.object({
  version: z.string().default('1.0.0'),
  baseUrl: z.string().default('/api/v1'),
  auth: z.object({
    type: z.enum(['jwt','session','oauth']),
    headerName: z.string().default('Authorization'),
    prefix: z.string().default('Bearer'),
  }).default({ type: 'jwt', headerName: 'Authorization', prefix: 'Bearer' }),
  endpoints: z.array(APIEndpointValidator).min(1, 'At least one endpoint required'),
});

// ── DB Schema ────────────────────────────────────────────────────────────────

const VALID_DB_TYPES = ['UUID','VARCHAR','TEXT','INTEGER','BIGINT','BOOLEAN','TIMESTAMP',
  'DECIMAL','JSONB','ENUM','FLOAT','DATE','SERIAL','SMALLINT'];

export const DBColumnValidator = z.object({
  name: z.string().min(1),
  type: z.string().refine(
    t => VALID_DB_TYPES.includes(t.toUpperCase()),
    t => ({ message: `Invalid column type: ${t}. Must be one of ${VALID_DB_TYPES.join(', ')}` })
  ),
  primaryKey: z.boolean().default(false),
  nullable: z.boolean().default(true),
  unique: z.boolean().default(false),
  default: z.any().nullable().optional(),
  references: z.object({
    table: z.string(),
    column: z.string(),
  }).optional(),
  enumValues: z.array(z.string()).default([]),
});

export const DBTableValidator = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  columns: z.array(DBColumnValidator).min(1).refine(
    cols => cols.some(c => c.primaryKey),
    { message: 'Table must have at least one primary key column' }
  ),
  indexes: z.array(z.object({
    name: z.string(),
    columns: z.array(z.string()),
    unique: z.boolean().default(false),
  })).default([]),
});

export const DBSchemaValidator = z.object({
  dialect: z.enum(['postgresql','sqlite','mysql','mongodb']).default('postgresql'),
  tables: z.array(DBTableValidator).min(1, 'At least one table required'),
  migrations: z.array(z.object({
    id: z.string(),
    description: z.string(),
    tables: z.array(z.string()),
  })).default([]),
});

// ── Auth Schema ───────────────────────────────────────────────────────────────

export const AuthPermissionValidator = z.object({
  resource: z.string(),
  actions: z.array(z.enum(['create','read','update','delete','*'])).min(1),
  conditions: z.array(z.string()).default([]),
});

export const AuthRoleValidator = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  inherits: z.array(z.string()).default([]),
  permissions: z.array(AuthPermissionValidator).default([]),
});

export const AuthSchemaValidator = z.object({
  strategy: z.enum(['jwt','session','oauth']).default('jwt'),
  jwtConfig: z.object({
    expiry: z.string(),
    refreshExpiry: z.string(),
    algorithm: z.string(),
  }).default({ expiry: '7d', refreshExpiry: '30d', algorithm: 'HS256' }),
  roles: z.array(AuthRoleValidator).min(1, 'At least one role required'),
  guards: z.array(z.object({
    name: z.string(),
    type: z.enum(['route','api','field']),
    target: z.string(),
    requires: z.object({ auth: z.boolean(), roles: z.array(z.string()) }),
  })).default([]),
  passwordPolicy: z.object({
    minLength: z.number().min(6).max(128),
    requireUppercase: z.boolean(),
    requireNumber: z.boolean(),
  }).default({ minLength: 8, requireUppercase: true, requireNumber: true }),
  socialAuth: z.array(z.string()).default([]),
});

// ── Master validator: run all 4 layers ───────────────────────────────────────

export function validateAllSchemas(schemas) {
  const results = {};
  
  results.ui = UISchemaValidator.safeParse(schemas.ui || {});
  results.api = APISchemaValidator.safeParse(schemas.api || {});
  results.db = DBSchemaValidator.safeParse(schemas.db || {});
  results.auth = AuthSchemaValidator.safeParse(schemas.auth || {});

  const allIssues = [];
  for (const [layer, result] of Object.entries(results)) {
    if (!result.success) {
      result.error.issues.forEach(issue => {
        allIssues.push({
          layer,
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
          // ZodIssue type gives us precise info for targeted repair
          zodCode: issue.code,
        });
      });
    }
  }

  return {
    valid: allIssues.length === 0,
    issues: allIssues,
    // Return validated (coerced) data where possible
    data: {
      ui: results.ui.success ? results.ui.data : schemas.ui,
      api: results.api.success ? results.api.data : schemas.api,
      db: results.db.success ? results.db.data : schemas.db,
      auth: results.auth.success ? results.auth.data : schemas.auth,
    },
  };
}

// ── Issue → Patch converter ───────────────────────────────────────────────────
// Maps ZodIssue codes to patch operations for the repair engine

export function zodIssueToPatch(issue) {
  const { layer, path, code, message } = issue;

  // Missing required field → add default
  if (code === 'too_small' && message.includes('required')) {
    return { operation: 'set_default', layer, path };
  }

  // Invalid enum value → reset to first valid option
  if (code === 'invalid_enum_value') {
    return { operation: 'reset_enum', layer, path };
  }

  // Missing primary key → add id column
  if (message.includes('primary key')) {
    return { operation: 'add_primary_key', layer, path };
  }

  // Path doesn't start with /
  if (message.includes("startsWith")) {
    return { operation: 'fix_path', layer, path };
  }

  // Invalid column type
  if (message.includes('Invalid column type')) {
    return { operation: 'fix_column_type', layer, path };
  }

  return { operation: 'log_only', layer, path, message };
}
