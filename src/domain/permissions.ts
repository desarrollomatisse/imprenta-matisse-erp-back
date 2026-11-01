import { Area, PermissionKey, RoleKey, ScopeType, SystemRole } from './enums';
import { ALL_AREA_KEYS } from './workflow';

// La base no guarda permisos: cada rol tiene un conjunto cerrado de concesiones
// definido aquí y el servidor las aplica en cada endpoint.

type PermissionDefinition = {
  key: PermissionKey;
  name: string;
  resource: string;
  action: string;
  scopes?: readonly ScopeType[];
  targetAreas?: boolean;
  adminOnly?: boolean;
};

export type PermissionGrant = {
  permission: PermissionKey;
  scopeType: ScopeType | null;
  areas: readonly string[];
  targetAreas: readonly string[];
};

const ALL_SCOPES = [
  ScopeType.ALL,
  ScopeType.ASSIGNED_AREAS,
  ScopeType.ASSIGNED_TO_ME,
];

export const PERMISSIONS: readonly PermissionDefinition[] = [
  {
    key: PermissionKey.ORDERS_READ,
    name: 'Consultar órdenes',
    resource: 'orders',
    action: 'read',
    scopes: ALL_SCOPES,
  },
  {
    key: PermissionKey.ORDERS_CREATE,
    name: 'Registrar órdenes',
    resource: 'orders',
    action: 'create',
  },
  {
    key: PermissionKey.ORDERS_EDIT,
    name: 'Editar datos de órdenes',
    resource: 'orders',
    action: 'update',
  },
  {
    key: PermissionKey.ORDERS_ASSIGN,
    name: 'Asignar órdenes',
    resource: 'orders',
    action: 'assign',
    targetAreas: true,
  },
  {
    key: PermissionKey.ORDERS_APPROVE,
    name: 'Aprobar órdenes',
    resource: 'orders',
    action: 'approve',
  },
  {
    key: PermissionKey.ORDERS_NOTE_CREATE,
    name: 'Agregar notas al historial',
    resource: 'orders',
    action: 'create_note',
  },
  {
    key: PermissionKey.ORDERS_CUSTOMER_NAME_READ,
    name: 'Ver nombre del cliente',
    resource: 'orders.customer',
    action: 'read_name',
  },
  {
    key: PermissionKey.ORDERS_CUSTOMER_PHONE_READ,
    name: 'Ver teléfono del cliente',
    resource: 'orders.customer',
    action: 'read_phone',
  },
  {
    key: PermissionKey.ORDERS_DELIVERY_ADDRESS_READ,
    name: 'Ver dirección de entrega',
    resource: 'orders',
    action: 'read_delivery_address',
  },
  {
    key: PermissionKey.TASKS_READ,
    name: 'Consultar tareas de trabajo',
    resource: 'tasks',
    action: 'read',
    scopes: ALL_SCOPES,
  },
  {
    key: PermissionKey.TASKS_INCIDENT_REPORT,
    name: 'Reportar incidencias de tareas',
    resource: 'tasks',
    action: 'report_incident',
  },
  {
    key: PermissionKey.TASKS_ASSIGN,
    name: 'Asignar tareas',
    resource: 'tasks',
    action: 'assign',
    targetAreas: true,
  },
  {
    key: PermissionKey.ORDERS_CANCEL,
    name: 'Cancelar órdenes',
    resource: 'orders',
    action: 'cancel',
  },
  {
    key: PermissionKey.ORDERS_REACTIVATE,
    name: 'Reactivar órdenes canceladas',
    resource: 'orders',
    action: 'reactivate',
  },
  {
    key: PermissionKey.ORDERS_DELETE,
    name: 'Eliminar órdenes',
    resource: 'orders',
    action: 'delete',
  },
  {
    key: PermissionKey.CATALOG_MANAGE,
    name: 'Corregir y eliminar elementos del catálogo',
    resource: 'catalog',
    action: 'manage',
  },
  {
    key: PermissionKey.AUDIT_READ,
    name: 'Consultar la bitácora',
    resource: 'audit',
    action: 'read',
  },
  {
    key: PermissionKey.USERS_MANAGE,
    name: 'Administrar usuarios y asignar roles',
    resource: 'users',
    action: 'manage',
    adminOnly: true,
  },
];

function grant(
  permission: PermissionKey,
  options: {
    scopeType?: ScopeType;
    areas?: readonly string[];
    targetAreas?: readonly string[];
  } = {},
): PermissionGrant {
  return {
    permission,
    scopeType: options.scopeType ?? null,
    areas: options.areas ?? [],
    targetAreas: options.targetAreas ?? [],
  };
}

const readArea = (permission: PermissionKey, area: string) =>
  grant(permission, { scopeType: ScopeType.ASSIGNED_AREAS, areas: [area] });

const readAll = (permission: PermissionKey) =>
  grant(permission, { scopeType: ScopeType.ALL });

function areaWorker(area: string, assignTo: readonly string[]) {
  return [
    readArea(PermissionKey.ORDERS_READ, area),
    readArea(PermissionKey.TASKS_READ, area),
    grant(PermissionKey.TASKS_INCIDENT_REPORT),
    grant(PermissionKey.TASKS_ASSIGN, { targetAreas: assignTo }),
    grant(PermissionKey.ORDERS_NOTE_CREATE),
  ];
}

const ROLE_GRANTS: Record<string, readonly PermissionGrant[]> = {
  [SystemRole.SUPERADMIN]: PERMISSIONS.map((definition) =>
    grant(definition.key, {
      scopeType: definition.scopes?.includes(ScopeType.ALL)
        ? ScopeType.ALL
        : undefined,
      targetAreas: definition.targetAreas ? ALL_AREA_KEYS : [],
    }),
  ),
  [SystemRole.ADMIN]: [grant(PermissionKey.USERS_MANAGE)],
  [RoleKey.ATTENTION]: [
    readAll(PermissionKey.ORDERS_READ),
    grant(PermissionKey.ORDERS_CREATE),
    grant(PermissionKey.ORDERS_ASSIGN, { targetAreas: [Area.DESIGN] }),
    grant(PermissionKey.ORDERS_NOTE_CREATE),
    grant(PermissionKey.ORDERS_CUSTOMER_NAME_READ),
    grant(PermissionKey.ORDERS_CUSTOMER_PHONE_READ),
    grant(PermissionKey.ORDERS_DELIVERY_ADDRESS_READ),
    readArea(PermissionKey.TASKS_READ, Area.ATTENTION),
    grant(PermissionKey.ORDERS_CANCEL),
    grant(PermissionKey.ORDERS_REACTIVATE),
  ],
  [RoleKey.DESIGN]: [
    ...areaWorker(Area.DESIGN, [Area.ATTENTION, Area.PRODUCTION]),
    grant(PermissionKey.ORDERS_CUSTOMER_NAME_READ),
  ],
  [RoleKey.PRODUCTION]: areaWorker(Area.PRODUCTION, [Area.FINISHING]),
  [RoleKey.FINISHING]: areaWorker(Area.FINISHING, [Area.MANAGEMENT]),
  [RoleKey.MANAGEMENT]: [
    readAll(PermissionKey.ORDERS_READ),
    grant(PermissionKey.ORDERS_CREATE),
    grant(PermissionKey.ORDERS_EDIT),
    grant(PermissionKey.ORDERS_ASSIGN, { targetAreas: ALL_AREA_KEYS }),
    grant(PermissionKey.ORDERS_APPROVE),
    grant(PermissionKey.ORDERS_CANCEL),
    grant(PermissionKey.ORDERS_REACTIVATE),
    grant(PermissionKey.ORDERS_DELETE),
    grant(PermissionKey.CATALOG_MANAGE),
    grant(PermissionKey.AUDIT_READ),
    grant(PermissionKey.ORDERS_NOTE_CREATE),
    grant(PermissionKey.ORDERS_CUSTOMER_NAME_READ),
    grant(PermissionKey.ORDERS_CUSTOMER_PHONE_READ),
    grant(PermissionKey.ORDERS_DELIVERY_ADDRESS_READ),
    readAll(PermissionKey.TASKS_READ),
    grant(PermissionKey.TASKS_INCIDENT_REPORT),
    grant(PermissionKey.TASKS_ASSIGN, { targetAreas: ALL_AREA_KEYS }),
  ],
  [RoleKey.CONSULTATION]: [
    readAll(PermissionKey.ORDERS_READ),
    readAll(PermissionKey.TASKS_READ),
    grant(PermissionKey.ORDERS_CUSTOMER_NAME_READ),
  ],
};

export const grantsForRole = (roleKey: string): readonly PermissionGrant[] =>
  ROLE_GRANTS[roleKey] ?? [];

export const hasCustomPermissions = (roleKey: string) =>
  roleKey !== SystemRole.SUPERADMIN && roleKey !== SystemRole.ADMIN;

// Administrar usuarios depende solo del rol: con un switch, quien lo recibiera
// podría darse a sí mismo cualquier otro permiso.
export const CONFIGURABLE_PERMISSIONS = PERMISSIONS.filter(
  (definition) => !definition.adminOnly,
);

export const roleHasPermission = (roleKey: string, permission: string) =>
  grantsForRole(roleKey).some((item) => item.permission === permission);

/** Un permiso agregado no tiene límite de área, como el del Superadministrador. */
export function effectiveGrants(
  roleKey: string,
  overrides: Record<string, boolean>,
): readonly PermissionGrant[] {
  if (!hasCustomPermissions(roleKey)) return grantsForRole(roleKey);
  const kept = grantsForRole(roleKey).filter(
    (item) => overrides[item.permission] !== false,
  );
  const added = ROLE_GRANTS[SystemRole.SUPERADMIN].filter(
    (item) =>
      overrides[item.permission] === true &&
      !roleHasPermission(roleKey, item.permission) &&
      CONFIGURABLE_PERMISSIONS.some(({ key }) => key === item.permission),
  );
  return [...kept, ...added];
}
