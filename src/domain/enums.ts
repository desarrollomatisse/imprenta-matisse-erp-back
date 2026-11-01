export const Area = {
  ATTENTION: 'attention',
  DESIGN: 'design',
  PRODUCTION: 'production',
  FINISHING: 'finishing',
  MANAGEMENT: 'management',
} as const;

export const OrderStatus = {
  RECEIVED: 'received',
  DESIGN: 'design',
  CUSTOMER_REVIEW: 'customerReview',
  PRODUCTION: 'production',
  FINISHING: 'finishing',
  APPROVAL: 'approval',
  READY: 'ready',
  INCIDENT: 'incident',
  CANCELLED: 'cancelled',
} as const;

export const TaskStatus = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export const ScopeType = {
  ALL: 'all',
  ASSIGNED_AREAS: 'assigned_areas',
  ASSIGNED_TO_ME: 'assigned_to_me',
} as const;
export type ScopeType = (typeof ScopeType)[keyof typeof ScopeType];

export const SystemRole = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'administrador',
} as const;

export const RoleKey = {
  ATTENTION: 'atencion',
  DESIGN: 'diseno',
  PRODUCTION: 'produccion',
  FINISHING: 'acabados',
  MANAGEMENT: 'gerencia',
  CONSULTATION: 'consulta',
} as const;

export const PermissionKey = {
  ORDERS_READ: 'orders.read',
  ORDERS_CREATE: 'orders.create',
  ORDERS_EDIT: 'orders.edit',
  ORDERS_ASSIGN: 'orders.assign',
  ORDERS_APPROVE: 'orders.approve',
  ORDERS_CANCEL: 'orders.cancel',
  ORDERS_REACTIVATE: 'orders.reactivate',
  ORDERS_DELETE: 'orders.delete',
  ORDERS_NOTE_CREATE: 'orders.note.create',
  ORDERS_CUSTOMER_NAME_READ: 'orders.customer.name.read',
  ORDERS_CUSTOMER_PHONE_READ: 'orders.customer.phone.read',
  ORDERS_DELIVERY_ADDRESS_READ: 'orders.delivery_address.read',
  TASKS_READ: 'tasks.read',
  TASKS_INCIDENT_REPORT: 'tasks.incident.report',
  TASKS_ASSIGN: 'tasks.assign',
  USERS_MANAGE: 'users.manage',
  CATALOG_MANAGE: 'catalog.manage',
  AUDIT_READ: 'audit.read',
} as const;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];
