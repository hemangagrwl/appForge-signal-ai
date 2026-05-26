/**
 * AppSpec — Intermediate Representation (IR)
 * 
 * The single source of truth that bridges Intent + SystemDesign
 * into a canonical, typed structure. ALL schema generators consume
 * ONLY this object. This guarantees cross-layer consistency by design.
 */

import { z } from 'zod';

// ── Primitive sub-schemas ────────────────────────────────────────────────────

export const FieldSchema = z.object({
  name: z.string(),
  type: z.enum(['string','number','boolean','date','email','enum','uuid','text','json','decimal','password']),
  required: z.boolean().default(true),
  unique: z.boolean().default(false),
  enumValues: z.array(z.string()).default([]),
  defaultValue: z.any().optional(),
  description: z.string().optional(),
});

export const RelationSchema = z.object({
  type: z.enum(['hasMany','belongsTo','hasOne','manyToMany']),
  entity: z.string(),
  via: z.string().optional(),
  foreignKey: z.string().optional(),
});

export const EntitySchema = z.object({
  name: z.string(),
  tableName: z.string(),
  description: z.string().default(''),
  fields: z.array(FieldSchema).default([]),
  relations: z.array(RelationSchema).default([]),
  softDelete: z.boolean().default(false),
  timestamps: z.boolean().default(true),
});

export const RoleSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  inherits: z.array(z.string()).default([]),
  permissions: z.array(z.object({
    resource: z.string(),
    actions: z.array(z.enum(['create','read','update','delete','*'])),
    conditions: z.array(z.string()).default([]),
  })).default([]),
  isDefault: z.boolean().default(false),
});

export const PageSchema = z.object({
  name: z.string(),
  route: z.string(),
  title: z.string(),
  layout: z.enum(['default','auth','minimal','dashboard','public']).default('default'),
  protected: z.boolean().default(true),
  roles: z.array(z.string()).default([]),
  sections: z.array(z.object({
    id: z.string(),
    type: z.enum(['hero','table','form','stats','chart','list','detail','modal','sidebar','empty']),
    title: z.string().optional(),
    entity: z.string().optional(),
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      type: z.enum(['text','email','password','select','checkbox','radio','date','number','textarea','file','hidden']),
      required: z.boolean().default(false),
      placeholder: z.string().optional(),
      options: z.array(z.string()).default([]),
      entityField: z.string().optional(),
    })).default([]),
    actions: z.array(z.object({
      label: z.string(),
      type: z.enum(['submit','link','modal','delete','api']),
      target: z.string(),
      roles: z.array(z.string()).default([]),
      method: z.string().optional(),
    })).default([]),
  })).default([]),
});

export const EndpointSchema = z.object({
  id: z.string(),
  group: z.string(),
  method: z.enum(['GET','POST','PUT','DELETE','PATCH']),
  path: z.string(),
  description: z.string().default(''),
  auth: z.boolean().default(true),
  roles: z.array(z.string()).default([]),
  entity: z.string().optional(),
  operation: z.enum(['list','get','create','update','delete','custom']).default('custom'),
  requestBody: z.record(z.any()).default({}),
  responses: z.record(z.any()).default({}),
  queryParams: z.array(z.object({
    name: z.string(),
    type: z.string().default('string'),
    required: z.boolean().default(false),
    description: z.string().optional(),
  })).default([]),
  rateLimited: z.boolean().default(false),
  premiumOnly: z.boolean().default(false),
});

export const BusinessRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  trigger: z.string(),
  action: z.string(),
  entities: z.array(z.string()).default([]),
  condition: z.string().optional(),
  premium: z.boolean().default(false),
});

export const AuthConfigSchema = z.object({
  strategy: z.enum(['jwt','session','oauth']).default('jwt'),
  jwtConfig: z.object({
    expiry: z.string().default('7d'),
    refreshExpiry: z.string().default('30d'),
    algorithm: z.string().default('HS256'),
  }).default({}),
  passwordPolicy: z.object({
    minLength: z.number().default(8),
    requireUppercase: z.boolean().default(true),
    requireNumber: z.boolean().default(true),
    requireSpecial: z.boolean().default(false),
  }).default({}),
  socialProviders: z.array(z.string()).default([]),
  mfaSupported: z.boolean().default(false),
});

// ── AppSpec IR (root) ────────────────────────────────────────────────────────

export const AppSpecSchema = z.object({
  metadata: z.object({
    appName: z.string(),
    appType: z.enum(['crm','ecommerce','saas','blog','dashboard','marketplace','social','tool','healthcare','education','other']),
    description: z.string(),
    version: z.string().default('1.0.0'),
    generatedAt: z.string(),
  }),
  entities: z.array(EntitySchema).default([]),
  pages: z.array(PageSchema).default([]),
  theme: z.object({
    primaryColor: z.string().default('#6366f1'),
    fontFamily: z.string().default('Inter'),
    mode: z.enum(['light','dark']).default('light'),
  }).default({}),
  endpoints: z.array(EndpointSchema).default([]),
  apiConfig: z.object({
    baseUrl: z.string().default('/api/v1'),
    version: z.string().default('1.0.0'),
    rateLimiting: z.boolean().default(true),
    cors: z.boolean().default(true),
  }).default({}),
  roles: z.array(RoleSchema).default([]),
  auth: AuthConfigSchema.default({}),
  businessRules: z.array(BusinessRuleSchema).default([]),
  features: z.object({
    payments: z.boolean().default(false),
    analytics: z.boolean().default(false),
    realtime: z.boolean().default(false),
    fileUpload: z.boolean().default(false),
    notifications: z.boolean().default(false),
    search: z.boolean().default(false),
    premium: z.boolean().default(false),
  }).default({}),
});

// ── Builder: Intent + SystemDesign → AppSpec IR ──────────────────────────────

export function buildAppSpec(intent, systemDesign) {
  const raw = {
    metadata: {
      appName: intent.appName,
      appType: intent.appType,
      description: intent.description,
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
    },
    entities: (intent.entities || []).map(e => ({
      name: e.name,
      tableName: toSnakePlural(e.name),
      description: e.description || '',
      fields: e.fields || [],
      relations: e.relations || [],
      softDelete: false,
      timestamps: true,
    })),
    pages: (
  systemDesign.navigationFlow?.length
    ? systemDesign.navigationFlow
    : (intent.pages || [
        { name: 'dashboard' },
        { name: 'home' }
      ])
).map(nav => {

    const pageName =
      nav.page ||
      nav.name ||
      nav;

    return {

      name: pageName,

      route:
        nav.route ||
        '/' + pageName.toLowerCase(),

      title:
        pageName
        .replace(/([A-Z])/g,' $1')
        .trim(),

      layout: nav.layout || 'default',

      protected:
        nav.protected !== false,

      roles:
        nav.roles || [],

      sections: [],
    };

}),
    theme: { primaryColor: '#6366f1', fontFamily: 'Inter', mode: 'light' },
    endpoints: (
    systemDesign.apiGroups?.length
    ? systemDesign.apiGroups
    : (intent.entities || []).map(e => ({

        group:e.name,

        endpoints:[

            {
                method:'GET',
                path:`/api/${e.name.toLowerCase()}`
            },

            {
                method:'POST',
                path:`/api/${e.name.toLowerCase()}`
            }

        ]

    }))
).flatMap(g =>
      (g.endpoints || []).map((ep, i) => ({
        id: `${g.group.toLowerCase().replace(/\s+/g,'_')}_${ep.method.toLowerCase()}_${i}`,
        group: g.group,
        method: ep.method,
        path: ep.path,
        description: ep.description || '',
        auth: ep.auth !== false,
        roles: ep.roles || [],
        operation: inferOperation(ep.method, ep.path),
        entity: inferEntity(ep.path, intent.entities),
        requestBody: ep.requestBody || {},
        responses: ep.responses || { '200': { description: 'Success' } },
        queryParams: (ep.queryParams || []).map(q =>
          typeof q === 'string' ? { name: q, type: 'string', required: false } : q
        ),
        rateLimited: false,
        premiumOnly: false,
      }))
    ),
    apiConfig: { baseUrl: '/api/v1', version: '1.0.0', rateLimiting: true, cors: true },
    roles: (intent.roles || []).map(r => ({
      name: r.name,
      description: r.description || '',
      inherits: [],
      permissions: (r.permissions || []).map(p => {
        const [resource, action] = p.split(':');
        return {
          resource: resource || '*',
          actions: action === '*' ? ['create','read','update','delete'] : [action || 'read'],
          conditions: [],
        };
      }),
      isDefault: r.name.toLowerCase() === 'user',
    })),
    auth: {
      strategy: systemDesign.techStack?.auth || 'jwt',
      jwtConfig: { expiry: '7d', refreshExpiry: '30d', algorithm: 'HS256' },
      passwordPolicy: { minLength: 8, requireUppercase: true, requireNumber: true, requireSpecial: false },
      socialProviders: [],
      mfaSupported: false,
    },
    businessRules: (systemDesign.businessRules || []).map((br, i) => ({
      id: br.id || `rule_${i}`,
      description: br.description || '',
      trigger: br.trigger || '',
      action: br.action || '',
      entities: br.entities || [],
      premium: false,
    })),
    features: {
      payments: !!intent.paymentRequired,
      analytics: !!(intent.roles || []).some(r => r.name.toLowerCase() === 'admin') &&
                 !!(intent.coreFeatures || []).some(f => /analytics|report|stat/i.test(f)),
      realtime: !!(intent.coreFeatures || []).some(f => /realtime|live|websocket|chat/i.test(f)),
      fileUpload: !!(intent.coreFeatures || []).some(f => /upload|file|attachment|image/i.test(f)),
      notifications: !!(intent.coreFeatures || []).some(f => /notif|email|alert|remind/i.test(f)),
      search: !!(intent.coreFeatures || []).some(f => /search|filter|find/i.test(f)),
      premium: !!intent.paymentRequired,
    },
  };

  const result = AppSpecSchema.safeParse(raw);
  if (!result.success) {
    console.warn('[AppSpec] IR issues:', result.error.issues.slice(0,3).map(i => i.message).join(', '));
  }
  return result.success ? result.data : AppSpecSchema.parse(raw);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function toSnakePlural(name) {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') + 's';
}

function inferOperation(method, path) {
  if (method === 'GET' && !/:/.test(path)) return 'list';
  if (method === 'GET') return 'get';
  if (method === 'POST') return 'create';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'DELETE') return 'delete';
  return 'custom';
}

function inferEntity(path, entities) {
  for (const e of (entities || [])) {
    const lower = e.name.toLowerCase();
    if (path.toLowerCase().includes('/' + lower) || path.toLowerCase().includes('/' + lower + 's')) {
      return e.name;
    }
  }
  return undefined;
}
