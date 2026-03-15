// constants/permissions.js

export const RESOURCES = {
  // System & Admin
  ROLES: 'roles',
  ADMINS: 'admins',
  USERS: 'users',
  PERMISSIONS: 'permissions',
  AUDIT_LOGS: 'auditLogs',

  // Core Business
  ORDERS: 'orders',
  PRODUCTS: 'products',
  PRODUCT_LOCATIONS: 'productLocations',
  LOCATIONS: 'locations',
  INVENTORY: 'inventory',
  CATEGORIES: 'categories',
  REVIEWS: 'reviews',
  CARTS: 'carts',

  // Financial
  PAYMENTS: 'payments',
  CREDIT_FACILITY: 'creditFacility',
  CREDIT: 'credit',
  INVOICES: 'invoices',
  VOUCHERS: 'vouchers',
  WALLETS: 'wallets',
  DISBURSEMENTS: 'disbursements',
  TRANSACTIONS: 'transactions',

  // Shipping & Logistics
  SHIPMENTS: 'shipments',
  DRIVERS: 'drivers',
  TRACKING: 'tracking',
  DELIVERY_ZONES: 'deliveryZones',

  // Content
  BLOG_POSTS: 'blogPosts',
  SEO: 'SEO',
  PAGES: 'pages',
  FAQS: 'faqs',
  TESTIMONIALS: 'testimonials',
  BANNERS: 'banners',

  // Communication
  NOTIFICATIONS: 'notifications',
  MESSAGES: 'messages',
  EMAIL_TEMPLATES: 'emailTemplates',
  SMS_TEMPLATES: 'smsTemplates',
  SUBSCRIBERS: 'subscribers',
  CONTACT_SUBMISSIONS: 'contactSubmissions',

  // Analytics & Reports
  DASHBOARD: 'dashboard',
  REPORTS: 'reports',
  ANALYTICS: 'analytics',
  SALES: 'sales',
  INCOME: 'income',
  VISITORS: 'visitors',

  // Marketing
  CAMPAIGNS: 'campaigns',
  DISCOUNTS: 'discounts',
  PROMOTIONS: 'promotions',
  COUPONS: 'coupons',

  // Settings & Configuration
  SETTINGS: 'settings',
  TAXES: 'taxes',
  SHIPPING_METHODS: 'shippingMethods',
  PAYMENT_METHODS: 'paymentMethods',
  CURRENCIES: 'currencies',

  // AI & Automation
  AI_CHAT: 'aiChat',
  PRICE_UPDATES: 'priceUpdates',
  AUTOMATION: 'automation',

  // Supply Chain
  SUPPLY_CHAIN: 'supplyChain',
  SUPPLIERS: 'suppliers',
  PROCUREMENT: 'procurement',

  // Cities/States/Countries
  COUNTRIES: 'countries',
  STATES: 'states',
  CITIES: 'cities',
};

export const ACTIONS = {
  // Basic CRUD
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',

  // Special Actions
  MANAGE: 'manage', // Full control over resource
  PUBLISH: 'publish', // Publish content
  ARCHIVE: 'archive', // Archive items
  RESTORE: 'restore', // Restore archived items
  APPROVE: 'approve', // Approve items (orders, reviews, etc.)
  REJECT: 'reject', // Reject items
  CANCEL: 'cancel', // Cancel orders/transactions
  REFUND: 'refund', // Process refunds
  EXPORT: 'export', // Export data
  IMPORT: 'import', // Import data

  // Chart/View Actions
  VIEW_CHART: 'view_chart', // View specific charts
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_REPORTS: 'view_reports',

  // Communication Actions
  SEND: 'send', // Send notifications/emails
  SEND_PRICE_UPDATE: 'send_price_update',
  BROADCAST: 'broadcast', // Broadcast to all users

  // Financial Actions
  PROCESS_PAYMENT: 'process_payment',
  VERIFY_PAYMENT: 'verify_payment',
  ISSUE_CREDIT: 'issue_credit',
  ADJUST_BALANCE: 'adjust_balance',

  // User Management
  ASSIGN_ROLE: 'assign_role',
  REVOKE_ROLE: 'revoke_role',
  IMPERSONATE: 'impersonate',
  VERIFY_USER: 'verify_user',
  BLOCK_USER: 'block_user',

  // Inventory Actions
  ADJUST_STOCK: 'adjust_stock',
  TRANSFER_STOCK: 'transfer_stock',
  COUNT_INVENTORY: 'count_inventory',

  // Shipping Actions
  TRACK_SHIPMENT: 'track_shipment',
  UPDATE_STATUS: 'update_status',
  ASSIGN_DRIVER: 'assign_driver',

  // Content Actions
  FEATURE: 'feature', // Feature items
  HIDE: 'hide', // Hide items
  MODERATE: 'moderate', // Moderate comments/reviews

  // Settings Actions
  CONFIGURE: 'configure', // Configure settings
  TOGGLE_FEATURE: 'toggle_feature', // Toggle features on/off
};

export const PERMISSION_SETS = {
  // Admin full access
  ADMIN_FULL_ACCESS: Object.values(RESOURCES).map((resource) => ({
    resource,
    actions: Object.values(ACTIONS),
  })),

  // Dashboard permissions
  DASHBOARD_VIEW: [
    { resource: RESOURCES.DASHBOARD, actions: [ACTIONS.READ] },
    { resource: RESOURCES.SALES, actions: [ACTIONS.VIEW_CHART] },
    { resource: RESOURCES.INCOME, actions: [ACTIONS.VIEW_CHART] },
    { resource: RESOURCES.VISITORS, actions: [ACTIONS.VIEW_CHART] },
  ],

  // Order management permissions
  ORDER_MANAGEMENT: [
    {
      resource: RESOURCES.ORDERS,
      actions: [
        ACTIONS.CREATE,
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.DELETE,
        ACTIONS.APPROVE,
        ACTIONS.CANCEL,
      ],
    },
    {
      resource: RESOURCES.INVOICES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE],
    },
    { resource: RESOURCES.TRANSACTIONS, actions: [ACTIONS.READ] },
  ],

  // Product management permissions
  PRODUCT_MANAGEMENT: [
    {
      resource: RESOURCES.PRODUCTS,
      actions: [
        ACTIONS.CREATE,
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.DELETE,
        ACTIONS.FEATURE,
      ],
    },
    {
      resource: RESOURCES.CATEGORIES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.INVENTORY,
      actions: [ACTIONS.READ, ACTIONS.ADJUST_STOCK],
    },
    { resource: RESOURCES.REVIEWS, actions: [ACTIONS.READ, ACTIONS.MODERATE] },
  ],

  // Customer management permissions
  CUSTOMER_MANAGEMENT: [
    {
      resource: RESOURCES.USERS,
      actions: [
        ACTIONS.CREATE,
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.BLOCK_USER,
        ACTIONS.VERIFY_USER,
      ],
    },
    {
      resource: RESOURCES.WALLETS,
      actions: [ACTIONS.READ, ACTIONS.ADJUST_BALANCE],
    },
    {
      resource: RESOURCES.SUBSCRIBERS,
      actions: [ACTIONS.READ, ACTIONS.CREATE, ACTIONS.DELETE],
    },
  ],

  // Shipping & logistics permissions
  SHIPPING_MANAGEMENT: [
    {
      resource: RESOURCES.SHIPMENTS,
      actions: [
        ACTIONS.CREATE,
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.DELETE,
        ACTIONS.TRACK_SHIPMENT,
        ACTIONS.ASSIGN_DRIVER,
      ],
    },
    {
      resource: RESOURCES.DRIVERS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.LOCATIONS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.DELIVERY_ZONES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
  ],

  // Financial permissions
  FINANCIAL_MANAGEMENT: [
    {
      resource: RESOURCES.PAYMENTS,
      actions: [
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.PROCESS_PAYMENT,
        ACTIONS.VERIFY_PAYMENT,
        ACTIONS.REFUND,
      ],
    },
    {
      resource: RESOURCES.CREDIT_FACILITY,
      actions: [ACTIONS.READ, ACTIONS.MANAGE, ACTIONS.ISSUE_CREDIT],
    },
    {
      resource: RESOURCES.VOUCHERS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.DISBURSEMENTS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE],
    },
  ],

  // Content management permissions
  CONTENT_MANAGEMENT: [
    {
      resource: RESOURCES.BLOG_POSTS,
      actions: [
        ACTIONS.CREATE,
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.DELETE,
        ACTIONS.PUBLISH,
        ACTIONS.ARCHIVE,
      ],
    },
    {
      resource: RESOURCES.PAGES,
      actions: [
        ACTIONS.CREATE,
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.DELETE,
        ACTIONS.PUBLISH,
      ],
    },
    {
      resource: RESOURCES.SEO,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE],
    },
    {
      resource: RESOURCES.FAQS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.TESTIMONIALS,
      actions: [
        ACTIONS.CREATE,
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.DELETE,
        ACTIONS.APPROVE,
      ],
    },
    {
      resource: RESOURCES.BANNERS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
  ],

  // Communication permissions
  COMMUNICATION_MANAGEMENT: [
    {
      resource: RESOURCES.NOTIFICATIONS,
      actions: [
        ACTIONS.CREATE,
        ACTIONS.SEND,
        ACTIONS.SEND_PRICE_UPDATE,
        ACTIONS.BROADCAST,
      ],
    },
    {
      resource: RESOURCES.MESSAGES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.EMAIL_TEMPLATES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.SMS_TEMPLATES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.CONTACT_SUBMISSIONS,
      actions: [ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
  ],

  // Analytics & Reports permissions
  ANALYTICS_ACCESS: [
    {
      resource: RESOURCES.REPORTS,
      actions: [ACTIONS.READ, ACTIONS.EXPORT, ACTIONS.VIEW_REPORTS],
    },
    { resource: RESOURCES.ANALYTICS, actions: [ACTIONS.READ, ACTIONS.EXPORT] },
    {
      resource: RESOURCES.SALES,
      actions: [ACTIONS.READ, ACTIONS.VIEW_CHART, ACTIONS.EXPORT],
    },
    {
      resource: RESOURCES.VISITORS,
      actions: [ACTIONS.READ, ACTIONS.VIEW_CHART, ACTIONS.EXPORT],
    },
  ],

  // Marketing permissions
  MARKETING_MANAGEMENT: [
    {
      resource: RESOURCES.CAMPAIGNS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.DISCOUNTS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.PROMOTIONS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.COUPONS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
  ],

  // Settings & Configuration permissions
  SETTINGS_MANAGEMENT: [
    {
      resource: RESOURCES.SETTINGS,
      actions: [ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.CONFIGURE],
    },
    {
      resource: RESOURCES.TAXES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.SHIPPING_METHODS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.PAYMENT_METHODS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.CURRENCIES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
  ],

  // Supply Chain permissions
  SUPPLY_CHAIN_MANAGEMENT: [
    {
      resource: RESOURCES.SUPPLY_CHAIN,
      actions: [ACTIONS.READ, ACTIONS.MANAGE, ACTIONS.UPDATE_STATUS],
    },
    {
      resource: RESOURCES.SUPPLIERS,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.PROCUREMENT,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.APPROVE],
    },
  ],

  // Geographic permissions
  GEOGRAPHIC_MANAGEMENT: [
    {
      resource: RESOURCES.COUNTRIES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.STATES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
    {
      resource: RESOURCES.CITIES,
      actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE],
    },
  ],

  // AI & Automation permissions
  AI_MANAGEMENT: [
    { resource: RESOURCES.AI_CHAT, actions: [ACTIONS.READ, ACTIONS.MANAGE] },
    {
      resource: RESOURCES.PRICE_UPDATES,
      actions: [ACTIONS.SEND, ACTIONS.VIEW_CHART],
    },
    {
      resource: RESOURCES.AUTOMATION,
      actions: [ACTIONS.READ, ACTIONS.MANAGE, ACTIONS.CONFIGURE],
    },
  ],
};

// Export the main permissions array in your original format
export const permissions = Object.values(RESOURCES).map((resource) => ({
  resource,
  actions: getDefaultActionsForResource(resource),
}));

// Helper function to get default actions for a resource
function getDefaultActionsForResource(resource) {
  // Special cases for different resource types
  switch (resource) {
    case RESOURCES.ORDERS:
    case RESOURCES.PAYMENTS:
      return [
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.APPROVE,
        ACTIONS.CANCEL,
        ACTIONS.REFUND,
      ];

    case RESOURCES.BLOG_POSTS:
      return [
        ACTIONS.CREATE,
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.DELETE,
        ACTIONS.PUBLISH,
        ACTIONS.ARCHIVE,
      ];

    case RESOURCES.NOTIFICATIONS:
      return [
        ACTIONS.CREATE,
        ACTIONS.SEND,
        ACTIONS.SEND_PRICE_UPDATE,
        ACTIONS.BROADCAST,
      ];

    case RESOURCES.SEO:
      return [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE];

    case RESOURCES.CREDIT_FACILITY:
    case RESOURCES.WALLETS:
      return [
        ACTIONS.READ,
        ACTIONS.MANAGE,
        ACTIONS.ADJUST_BALANCE,
        ACTIONS.ISSUE_CREDIT,
      ];

    case RESOURCES.DASHBOARD:
    case RESOURCES.SALES:
    case RESOURCES.INCOME:
    case RESOURCES.VISITORS:
      return [ACTIONS.READ, ACTIONS.VIEW_CHART];

    case RESOURCES.REPORTS:
    case RESOURCES.ANALYTICS:
      return [ACTIONS.READ, ACTIONS.EXPORT, ACTIONS.VIEW_REPORTS];

    case RESOURCES.SETTINGS:
      return [
        ACTIONS.READ,
        ACTIONS.UPDATE,
        ACTIONS.CONFIGURE,
        ACTIONS.TOGGLE_FEATURE,
      ];

    default:
      // Default CRUD for most resources
      return [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE, ACTIONS.DELETE];
  }
}
