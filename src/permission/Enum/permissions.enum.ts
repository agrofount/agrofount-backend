export const permissions = [
  {
    resource: 'roles',
    actions: ['create', 'read', 'update', 'delete'],
  },

  {
    resource: 'admins',
    actions: ['create', 'read', 'update', 'delete'],
  },

  {
    resource: 'users',
    actions: ['create', 'read', 'update', 'delete'],
  },

  {
    resource: 'orders',
    actions: ['read', 'update'],
  },

  {
    resource: 'products',
    actions: ['create', 'read', 'update', 'delete'],
  },

  {
    resource: 'productLocations',
    actions: ['create', 'read', 'update', 'delete'],
  },

  {
    resource: 'SEO',
    actions: ['create', 'read', 'update'],
  },

  {
    resource: 'locations',
    actions: ['create', 'read', 'update', 'delete'],
  },

  {
    resource: 'shipments',
    actions: ['create', 'read', 'update', 'delete'],
  },

  {
    resource: 'blogPosts',
    actions: ['create', 'update', 'delete', 'publish'],
  },

  {
    resource: 'payments',
    actions: ['read', 'update'],
  },

  {
    resource: 'creditFacility',
    actions: ['read', 'manage'],
  },

  {
    resource: 'drivers',
    actions: ['read', 'create', 'update', 'delete'],
  },

  {
    resource: 'notifications',
    actions: ['create', 'send_price_update'],
  },

  {
    resource: 'carts',
    actions: ['manage'],
  },
];
