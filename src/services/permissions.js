/**
 * permissions.js
 * Role-based access control for the CRM.
 * Roles: Admin | Sales | Accountant | Operations
 */

export const ROLES = ["Admin", "Sales", "Accountant", "Operations"];

// canView / canEdit / canDelete / canExport per module per role
const PERMISSIONS = {
  Admin: {
    dashboard:  { view: true,  edit: true,  delete: true,  export: true  },
    leads:      { view: true,  edit: true,  delete: true,  export: true  },
    clients:    { view: true,  edit: true,  delete: true,  export: true  },
    accounting: { view: true,  edit: true,  delete: true,  export: true  },
    tasks:      { view: true,  edit: true,  delete: true,  export: true  },
    inventory:  { view: true,  edit: true,  delete: true,  export: true  },
    suppliers:  { view: true,  edit: true,  delete: true,  export: true  },
    calendar:   { view: true,  edit: true,  delete: true,  export: true  },
    analytics:  { view: true,  edit: true,  delete: true,  export: true  },
    reports:    { view: true,  edit: true,  delete: true,  export: true  },
    audit:      { view: true,  edit: false, delete: false,  export: true  },
    automations:{ view: true,  edit: true,  delete: true,  export: false },
    settings:   { view: true,  edit: true,  delete: false, export: false },
  },
  Sales: {
    dashboard:  { view: true,  edit: false, delete: false, export: false },
    leads:      { view: true,  edit: true,  delete: false, export: false },
    clients:    { view: true,  edit: true,  delete: false, export: false },
    accounting: { view: true,  edit: false, delete: false, export: false },
    tasks:      { view: true,  edit: true,  delete: false, export: false },
    inventory:  { view: true,  edit: false, delete: false, export: false },
    suppliers:  { view: false, edit: false, delete: false, export: false },
    calendar:   { view: true,  edit: true,  delete: false, export: false },
    analytics:  { view: true,  edit: false, delete: false, export: false },
    reports:    { view: true,  edit: false, delete: false, export: false },
    audit:      { view: false, edit: false, delete: false, export: false },
    automations:{ view: false, edit: false, delete: false, export: false },
    settings:   { view: true,  edit: true,  delete: false, export: false },
  },
  Accountant: {
    dashboard:  { view: true,  edit: false, delete: false, export: true  },
    leads:      { view: true,  edit: false, delete: false, export: false },
    clients:    { view: true,  edit: false, delete: false, export: true  },
    accounting: { view: true,  edit: true,  delete: false, export: true  },
    tasks:      { view: true,  edit: true,  delete: false, export: false },
    inventory:  { view: true,  edit: false, delete: false, export: true  },
    suppliers:  { view: true,  edit: true,  delete: false, export: true  },
    calendar:   { view: true,  edit: false, delete: false, export: false },
    analytics:  { view: true,  edit: false, delete: false, export: true  },
    reports:    { view: true,  edit: false, delete: false, export: true  },
    audit:      { view: true,  edit: false, delete: false, export: true  },
    automations:{ view: false, edit: false, delete: false, export: false },
    settings:   { view: true,  edit: true,  delete: false, export: false },
  },
  Operations: {
    dashboard:  { view: true,  edit: false, delete: false, export: false },
    leads:      { view: true,  edit: true,  delete: false, export: false },
    clients:    { view: true,  edit: true,  delete: false, export: false },
    accounting: { view: false, edit: false, delete: false, export: false },
    tasks:      { view: true,  edit: true,  delete: true,  export: false },
    inventory:  { view: true,  edit: true,  delete: false, export: false },
    suppliers:  { view: true,  edit: true,  delete: false, export: false },
    calendar:   { view: true,  edit: true,  delete: true,  export: false },
    analytics:  { view: false, edit: false, delete: false, export: false },
    reports:    { view: false, edit: false, delete: false, export: false },
    audit:      { view: false, edit: false, delete: false, export: false },
    automations:{ view: true,  edit: false, delete: false, export: false },
    settings:   { view: true,  edit: true,  delete: false, export: false },
  },
};

export function can(role, module, action) {
  return PERMISSIONS[role]?.[module]?.[action] ?? false;
}

export function getVisibleModules(role) {
  return Object.entries(PERMISSIONS[role] ?? {})
    .filter(([, perms]) => perms.view)
    .map(([mod]) => mod);
}
