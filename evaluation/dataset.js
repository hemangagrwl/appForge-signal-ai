/**
 * Evaluation Dataset
 * 10 real product prompts + 10 edge cases.
 * Used by the benchmark runner to track: success rate, retries, failure types, latency.
 */

export const EVAL_DATASET = {
  realPrompts: [
    {
      id: 'real_01',
      prompt: "Build a CRM with login, contacts, dashboard, role-based access (admin and sales roles), and premium plan with payments. Admins can see analytics and manage team members.",
      expectedEntities: ['Contact', 'User', 'Deal'],
      expectedPages: ['Login', 'Dashboard', 'Contacts'],
      expectedFeatures: ['auth', 'payments', 'analytics'],
    },
    {
      id: 'real_02',
      prompt: "Create an e-commerce platform with product listings, shopping cart, checkout with Stripe, order tracking, customer reviews, and a seller dashboard with inventory management.",
      expectedEntities: ['Product', 'Order', 'User', 'Cart'],
      expectedPages: ['Shop', 'Cart', 'Checkout', 'Orders'],
      expectedFeatures: ['payments', 'auth'],
    },
    {
      id: 'real_03',
      prompt: "Build a project management tool like Trello with boards, cards, lists, team collaboration, file attachments, deadline reminders, and activity timeline.",
      expectedEntities: ['Board', 'Card', 'List', 'User'],
      expectedPages: ['Boards', 'Board', 'Card'],
      expectedFeatures: ['auth', 'fileUpload', 'notifications'],
    },
    {
      id: 'real_04',
      prompt: "Create a blog platform with post editor, comments, categories, tags, author profiles, and RSS feed. Admins can moderate content.",
      expectedEntities: ['Post', 'Comment', 'User', 'Category'],
      expectedPages: ['Blog', 'Post', 'Admin'],
      expectedFeatures: ['auth'],
    },
    {
      id: 'real_05',
      prompt: "Build an HR system with employee directory, leave management, payroll report generation, department hierarchy, and performance reviews.",
      expectedEntities: ['Employee', 'Leave', 'Department'],
      expectedPages: ['Employees', 'Leave', 'Payroll'],
      expectedFeatures: ['auth', 'analytics'],
    },
    {
      id: 'real_06',
      prompt: "Create a learning management system with courses, video lessons, quizzes, progress tracking, certificates on completion, and instructor dashboard.",
      expectedEntities: ['Course', 'Lesson', 'Quiz', 'User'],
      expectedPages: ['Courses', 'Lesson', 'Dashboard'],
      expectedFeatures: ['auth', 'payments'],
    },
    {
      id: 'real_07',
      prompt: "Build a real estate listing platform with property search and filters, favorites, agent contact form, mortgage calculator, and property comparison.",
      expectedEntities: ['Property', 'Agent', 'User'],
      expectedPages: ['Search', 'Property', 'Favorites'],
      expectedFeatures: ['search'],
    },
    {
      id: 'real_08',
      prompt: "Create a healthcare appointment system with doctor profiles, booking calendar, appointment reminders, medical history view, and billing with insurance info.",
      expectedEntities: ['Doctor', 'Appointment', 'Patient'],
      expectedPages: ['Booking', 'Appointments', 'Profile'],
      expectedFeatures: ['auth', 'notifications', 'payments'],
    },
    {
      id: 'real_09',
      prompt: "Build a restaurant management system with digital menu, online ordering, table reservations, kitchen order display, inventory tracking, and daily sales reports.",
      expectedEntities: ['MenuItem', 'Order', 'Table', 'Reservation'],
      expectedPages: ['Menu', 'Orders', 'Reservations', 'Reports'],
      expectedFeatures: ['auth', 'analytics'],
    },
    {
      id: 'real_10',
      prompt: "Create a freelance marketplace where clients post jobs, freelancers submit proposals, both can message, contracts are managed, and payments held in escrow until completion.",
      expectedEntities: ['Job', 'Proposal', 'User', 'Contract', 'Message'],
      expectedPages: ['Jobs', 'Profile', 'Messages', 'Contracts'],
      expectedFeatures: ['auth', 'payments', 'realtime'],
    },
  ],

  edgeCases: [
    // ── Vague ──────────────────────────────────────────────────────────────
    {
      id: 'edge_01',
      category: 'vague',
      prompt: "Build an app",
      expectedBehavior: 'clarification',
      description: 'Extremely vague — should trigger clarification flow',
    },
    {
      id: 'edge_02',
      category: 'vague',
      prompt: "Make something for my small business",
      expectedBehavior: 'clarification',
      description: 'Vague but business context — should ask what kind',
    },

    // ── Conflicting ────────────────────────────────────────────────────────
    {
      id: 'edge_03',
      category: 'conflicting',
      prompt: "Build a completely free app with premium features that everyone can access without paying but also has paid subscription tiers that unlock the same features",
      expectedBehavior: 'proceed_with_assumptions',
      description: 'Contradictory free vs paid — should document conflict and assume tiered model',
    },
    {
      id: 'edge_04',
      category: 'conflicting',
      prompt: "Create a private social network that is completely public and anonymous but also has verified user profiles with real names",
      expectedBehavior: 'proceed_with_assumptions',
      description: 'Public vs private vs anonymous contradiction',
    },

    // ── Incomplete ─────────────────────────────────────────────────────────
    {
      id: 'edge_05',
      category: 'incomplete',
      prompt: "CRM with contacts",
      expectedBehavior: 'proceed_with_assumptions',
      description: 'Minimal but clear enough to infer standard CRM features',
    },
    {
      id: 'edge_06',
      category: 'incomplete',
      prompt: "Dashboard with charts and tables",
      expectedBehavior: 'proceed_with_assumptions',
      description: 'No domain, no entities — should make reasonable assumptions',
    },

    // ── Over-specified ─────────────────────────────────────────────────────
    {
      id: 'edge_07',
      category: 'over_specified',
      prompt: "Build a multi-tenant SaaS with microservices, GraphQL, Redis caching, event sourcing, CQRS, WebSocket real-time updates, row-level security, white-label theming, i18n for 20 languages, SOC2 compliance tools, GDPR data export, A/B testing framework, feature flags, and ML-based recommendation engine",
      expectedBehavior: 'proceed_with_partial',
      description: 'Extremely complex — should capture core entities and note limitations',
    },

    // ── Ambiguous roles ────────────────────────────────────────────────────
    {
      id: 'edge_08',
      category: 'ambiguous',
      prompt: "Build a marketplace where buyers and sellers can both post listings, both can review each other, and some users can be admin but also buyers and sellers at the same time",
      expectedBehavior: 'proceed_with_assumptions',
      description: 'Fluid roles — should create compound role model',
    },

    // ── No auth ────────────────────────────────────────────────────────────
    {
      id: 'edge_09',
      category: 'no_auth',
      prompt: "Build a public read-only news aggregator that shows headlines from RSS feeds, no login required, no user accounts, just browse and search articles",
      expectedBehavior: 'proceed',
      description: 'Explicitly no auth — should respect this and not add auth',
    },

    // ── Domain-specific jargon ─────────────────────────────────────────────
    {
      id: 'edge_10',
      category: 'jargon',
      prompt: "Build a SCIM 2.0 compliant directory service with RBAC, ABAC, OAuth2 PKCE flow, OpenID Connect, SAML 2.0 SSO, MFA with TOTP/FIDO2, and audit log with SIEM integration",
      expectedBehavior: 'proceed_with_partial',
      description: 'Heavy security jargon — should capture auth entities and note advanced requirements',
    },
  ],
};

export function getPromptById(id) {
  const all = [...EVAL_DATASET.realPrompts, ...EVAL_DATASET.edgeCases];
  return all.find(p => p.id === id);
}

export function getAllPrompts() {
  return [
    ...EVAL_DATASET.realPrompts.map(p => ({ ...p, category: 'real' })),
    ...EVAL_DATASET.edgeCases,
  ];
}
