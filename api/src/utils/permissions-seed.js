/**
 * Default Roles & Permissions Definition and Seeder
 */

const DEFAULT_ROLES = [
  {
    id: 'admin',
    name: 'Administrator',
    description: 'Full administrative access to all modules and configurations',
    is_system: 1
  },
  {
    id: 'manager',
    name: 'Manager',
    description: 'Operations manager with full operational access and approval power',
    is_system: 1
  },
  {
    id: 'office',
    name: 'Office / Store',
    description: 'Central store and procurement team, handling inventory and preparing quotes without approval authority',
    is_system: 1
  },
  {
    id: 'user',
    name: 'Site User',
    description: 'Site / field personnel managing local stock and receiving quotes for their assigned site',
    is_system: 1
  },
  {
    id: 'driver',
    name: 'Driver',
    description: 'Driver personnel with access to own vehicle tracking voyages',
    is_system: 1
  }
];

const MODULE_DEFINITIONS = [
  { key: 'req_create', category: 'Requirements', name: 'Create Requirement', moduleFile: 'CreateReq.html', navId: 'nav-CreateReq' },
  { key: 'req_view', category: 'Requirements', name: 'View Requirements', moduleFile: 'ViewReq.html', navId: 'nav-ViewReq' },
  { key: 'req_approve', category: 'Requirements', name: 'Approve Requirements', moduleFile: 'ViewReq.html', navId: null },
  { key: 'quote_mgmt', category: 'Procurement', name: 'Quote Management & RFQ', moduleFile: 'QuoteMgmt.html', navId: 'nav-QuoteMgmt' },
  { key: 'quote_approve', category: 'Procurement', name: 'Approve Quotes', moduleFile: 'QuoteMgmt.html', navId: null },
  { key: 'quote_receive', category: 'Procurement', name: 'Receive Despatched Quotes', moduleFile: 'QuoteMgmt.html', navId: null },
  { key: 'products', category: 'Catalog', name: 'Products Catalog', moduleFile: 'Products.html', navId: 'nav-Products' },
  { key: 'stock', category: 'Inventory', name: 'Stock Management', moduleFile: 'Stock.html', navId: 'nav-Stock' },
  { key: 'stock_count', category: 'Inventory', name: 'Stock Count', moduleFile: 'Scanner.html', navId: 'nav-Scanner' },
  { key: 'movements', category: 'Inventory', name: 'Inventory Movements', moduleFile: 'InvMov.html', navId: 'nav-InvMov' },
  { key: 'fuel', category: 'Operations', name: 'Fuel Control', moduleFile: 'ControlCombustible.html', navId: 'nav-ControlCombustible' },
  { key: 'vehicle_tracking', category: 'Operations', name: 'Vehicle Tracking', moduleFile: 'VehicleTracking.html', navId: 'nav-VehicleTracking' },
  { key: 'fleet_map', category: 'Operations', name: 'Fleet Tracking Map', moduleFile: 'FleetMap.html', navId: 'nav-FleetMap' },
  { key: 'assets', category: 'Operations', name: 'Asset Management', moduleFile: 'GestionActivos.html', navId: 'nav-GestionActivos' },
  { key: 'system_integrations', category: 'System', name: 'Integrations (Azure, OpSphere, Sheets)', moduleFile: 'AzureTest.html', navId: 'nav-AzureTest' },
  { key: 'admin_val', category: 'System', name: 'Administration & Role Permissions', moduleFile: 'AdminVal.html', navId: 'nav-AdminVal' },
  { key: 'site_transfer', category: 'Inventory', name: 'Intra Site Transfer', moduleFile: 'SiteTransfer.html', navId: 'nav-SiteTransfer' }
];

// Matrix templates for each system role:
// [module_key, can_view, can_edit, can_approve, site_scope]
const ROLE_PERMISSIONS_DEFAULTS = {
  admin: [
    ['req_create', 1, 1, 1, 'all'],
    ['req_view', 1, 1, 1, 'all'],
    ['req_approve', 1, 1, 1, 'all'],
    ['quote_mgmt', 1, 1, 1, 'all'],
    ['quote_approve', 1, 1, 1, 'all'],
    ['quote_receive', 1, 1, 1, 'all'],
    ['products', 1, 1, 1, 'all'],
    ['stock', 1, 1, 1, 'all'],
    ['stock_count', 1, 1, 1, 'all'],
    ['movements', 1, 1, 1, 'all'],
    ['fuel', 1, 1, 1, 'all'],
    ['vehicle_tracking', 1, 1, 1, 'all'],
    ['fleet_map', 1, 1, 1, 'all'],
    ['assets', 1, 1, 1, 'all'],
    ['system_integrations', 1, 1, 1, 'all'],
    ['admin_val', 1, 1, 1, 'all'],
    ['site_transfer', 1, 1, 1, 'all']
  ],
  manager: [
    ['req_create', 1, 1, 1, 'all'],
    ['req_view', 1, 1, 1, 'all'],
    ['req_approve', 1, 1, 1, 'all'],
    ['quote_mgmt', 1, 1, 1, 'all'],
    ['quote_approve', 1, 1, 1, 'all'],
    ['quote_receive', 1, 1, 1, 'all'],
    ['products', 1, 1, 1, 'all'],
    ['stock', 1, 1, 1, 'all'],
    ['stock_count', 1, 1, 1, 'all'],
    ['movements', 1, 1, 1, 'all'],
    ['fuel', 1, 1, 1, 'all'],
    ['vehicle_tracking', 1, 1, 1, 'all'],
    ['fleet_map', 1, 1, 1, 'all'],
    ['assets', 1, 1, 1, 'all'],
    ['system_integrations', 0, 0, 0, 'all'],
    ['admin_val', 0, 0, 0, 'all'],
    ['site_transfer', 1, 1, 1, 'all']
  ],
  office: [
    ['req_create', 1, 1, 0, 'all'],
    ['req_view', 1, 1, 0, 'all'],
    ['req_approve', 0, 0, 0, 'all'],
    ['quote_mgmt', 1, 1, 0, 'all'],
    ['quote_approve', 0, 0, 0, 'all'],
    ['quote_receive', 1, 1, 0, 'all'],
    ['products', 1, 1, 0, 'all'],
    ['stock', 1, 1, 0, 'all'],
    ['stock_count', 1, 1, 0, 'all'],
    ['movements', 1, 1, 0, 'all'],
    ['fuel', 1, 1, 0, 'all'],
    ['vehicle_tracking', 1, 1, 0, 'all'],
    ['fleet_map', 1, 0, 0, 'all'],
    ['assets', 1, 1, 0, 'all'],
    ['system_integrations', 0, 0, 0, 'all'],
    ['admin_val', 0, 0, 0, 'all'],
    ['site_transfer', 1, 1, 0, 'assigned']
  ],
  user: [
    ['req_create', 1, 1, 0, 'assigned'],
    ['req_view', 1, 0, 0, 'assigned'],
    ['req_approve', 0, 0, 0, 'assigned'],
    ['quote_mgmt', 1, 0, 0, 'assigned'],
    ['quote_approve', 0, 0, 0, 'assigned'],
    ['quote_receive', 1, 1, 0, 'assigned'],
    ['products', 1, 0, 0, 'all'],       // View-only catalog
    ['stock', 1, 1, 0, 'assigned'],      // Own site stock management
    ['stock_count', 1, 1, 0, 'assigned'],// Own site stock count
    ['movements', 1, 1, 0, 'assigned'],  // Own site movements
    ['fuel', 1, 1, 0, 'assigned'],       // Own site fuel
    ['vehicle_tracking', 1, 1, 0, 'assigned'],
    ['fleet_map', 1, 0, 0, 'assigned'],
    ['assets', 1, 0, 0, 'assigned'],     // Own site assets
    ['system_integrations', 0, 0, 0, 'all'],
    ['admin_val', 0, 0, 0, 'all'],
    ['site_transfer', 1, 1, 0, 'assigned']  // Own site transfers (sent or received)
  ],
  driver: [
    ['req_create', 0, 0, 0, 'assigned'],
    ['req_view', 0, 0, 0, 'assigned'],
    ['req_approve', 0, 0, 0, 'assigned'],
    ['quote_mgmt', 0, 0, 0, 'assigned'],
    ['quote_approve', 0, 0, 0, 'assigned'],
    ['quote_receive', 0, 0, 0, 'assigned'],
    ['products', 1, 0, 0, 'all'],       // View-only catalog
    ['stock', 0, 0, 0, 'assigned'],
    ['stock_count', 0, 0, 0, 'assigned'],
    ['movements', 0, 0, 0, 'assigned'],
    ['fuel', 1, 1, 0, 'assigned'],       // Fuel entry
    ['vehicle_tracking', 1, 1, 0, 'assigned'], // Own trips only
    ['fleet_map', 1, 0, 0, 'assigned'],
    ['assets', 0, 0, 0, 'assigned'],
    ['system_integrations', 0, 0, 0, 'all'],
    ['admin_val', 0, 0, 0, 'all'],
    ['site_transfer', 0, 0, 0, 'assigned']
  ]
};

/**
 * Seeds roles and role_permissions if they do not exist
 * Works with better-sqlite3 instance
 */
function seedPermissions(sqlite) {
  try {
    const tableExists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roles'").get();
    if (!tableExists) return;

    // Seed roles
    const insertRole = sqlite.prepare(`
      INSERT OR IGNORE INTO roles (id, name, description, is_system)
      VALUES (?, ?, ?, ?)
    `);

    for (const r of DEFAULT_ROLES) {
      insertRole.run(r.id, r.name, r.description, r.is_system);
    }

    // Seed permissions
    const insertPerm = sqlite.prepare(`
      INSERT OR IGNORE INTO role_permissions (role_id, module_key, can_view, can_edit, can_approve, site_scope)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const [roleId, perms] of Object.entries(ROLE_PERMISSIONS_DEFAULTS)) {
      for (const [moduleKey, canView, canEdit, canApprove, siteScope] of perms) {
        insertPerm.run(roleId, moduleKey, canView, canEdit, canApprove, siteScope);
      }
    }
  } catch (err) {
    console.error('[seedPermissions] Warning:', err.message);
  }
}

module.exports = {
  DEFAULT_ROLES,
  MODULE_DEFINITIONS,
  ROLE_PERMISSIONS_DEFAULTS,
  seedPermissions
};

