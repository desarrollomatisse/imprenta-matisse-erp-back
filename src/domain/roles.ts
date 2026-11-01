import { RoleKey, SystemRole } from './enums';

export const ROLE_NAMES: Record<string, string> = {
  [SystemRole.SUPERADMIN]: 'Superadministrador',
  [SystemRole.ADMIN]: 'Administrador',
  [RoleKey.ATTENTION]: 'Atención',
  [RoleKey.DESIGN]: 'Diseño',
  [RoleKey.PRODUCTION]: 'Producción',
  [RoleKey.FINISHING]: 'Acabados',
  [RoleKey.MANAGEMENT]: 'Gerencia',
  [RoleKey.CONSULTATION]: 'Consulta',
};

export const ROLE_KEYS = Object.keys(ROLE_NAMES);

export const isKnownRole = (roleKey: string) => roleKey in ROLE_NAMES;

export const isAdministrator = (roleKey: string | null | undefined) =>
  roleKey === SystemRole.SUPERADMIN || roleKey === SystemRole.ADMIN;
