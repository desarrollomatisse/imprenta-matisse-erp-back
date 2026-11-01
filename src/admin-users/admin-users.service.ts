import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { endSessions } from '../auth/session';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '../common/errors';
import { UserEntity } from '../database/entities';
import { CurrentUser } from '../domain/current-user';
import { SystemRole } from '../domain/enums';
import { generateTemporaryPassword, hashPassword } from '../domain/passwords';
import {
  CONFIGURABLE_PERMISSIONS,
  effectiveGrants,
  hasCustomPermissions,
  roleHasPermission,
} from '../domain/permissions';
import { isAdministrator, ROLE_NAMES } from '../domain/roles';
import { UserCreate, UserUpdate } from './admin-users.schemas';

const PROTECTED_ACCOUNT =
  'Solo el Superadministrador puede administrar cuentas Superadministrador o Administrador.';

const isProtectedRole = (roleKey: string) =>
  roleKey === SystemRole.SUPERADMIN || roleKey === SystemRole.ADMIN;

const toResponse = (user: UserEntity) => ({
  email: user.email,
  roleKey: user.roleKey,
  roleName: ROLE_NAMES[user.roleKey] ?? null,
  active: user.active,
  administrator: isAdministrator(user.roleKey),
  customPermissions: Object.keys(user.permissionOverrides).length,
  createdAt: user.createdAt.toISOString(),
});

function permissionsResponse(user: UserEntity) {
  const granted = effectiveGrants(user.roleKey, user.permissionOverrides);
  return {
    email: user.email,
    editable: hasCustomPermissions(user.roleKey),
    permissions: CONFIGURABLE_PERMISSIONS.map(({ key, name, resource }) => ({
      key,
      name,
      group: resource,
      enabled: granted.some((item) => item.permission === key),
      roleDefault: roleHasPermission(user.roleKey, key),
      customized: key in user.permissionOverrides,
    })),
  };
}

function ensureAssignableRole(roleKey: string, actor: CurrentUser): void {
  if (isProtectedRole(roleKey) && !actor.isSuperadmin) {
    throw new ForbiddenError(
      'Solo el Superadministrador puede asignar roles administrativos.',
    );
  }
}

@Injectable()
export class AdminUsersService {
  constructor(private readonly db: DataSource) {}

  private findForUpdate(
    manager: EntityManager,
    email: string,
    includeDeleted = false,
  ) {
    const query = manager
      .createQueryBuilder(UserEntity, 'u')
      .where('u.email = :email', { email })
      .setLock('pessimistic_write');
    if (includeDeleted) query.withDeleted();
    return query.getOne();
  }

  async list() {
    const users = await this.db.manager.find(UserEntity, {
      order: { email: 'ASC' },
    });
    return users.map(toResponse);
  }

  async add(actor: CurrentUser, payload: UserCreate) {
    const { email, roleKey } = payload;
    ensureAssignableRole(roleKey, actor);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    let created = false;
    try {
      const user = await this.db.transaction(async (manager) => {
        const current = await this.findForUpdate(manager, email, true);
        if (current?.deletedAt) {
          // Una cuenta eliminada vuelve con clave nueva y sin sus sesiones.
          created = true;
          await manager.update(UserEntity, email, {
            roleKey,
            passwordHash,
            mustChangePassword: true,
            permissionOverrides: {},
            active: true,
            deletedAt: null,
            deletedBy: null,
          });
          return { ...current, roleKey, active: true, permissionOverrides: {} };
        }
        if (!current) {
          created = true;
          return manager.save(
            manager.create(UserEntity, {
              email,
              roleKey,
              passwordHash,
              mustChangePassword: true,
              active: true,
              createdAt: new Date(),
            }),
          );
        }
        if (email === actor.email) {
          throw new ForbiddenError('No puedes modificar tu propia cuenta.');
        }
        if (isProtectedRole(current.roleKey) && !actor.isSuperadmin) {
          throw new ForbiddenError(PROTECTED_ACCOUNT);
        }
        if (current.roleKey !== roleKey) current.permissionOverrides = {};
        current.roleKey = roleKey;
        current.active = true;
        return manager.save(current);
      });
      // Solo se revela aquí: la base guarda el hash.
      return { ...toResponse(user), ...(created ? { temporaryPassword } : {}) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('No se pudo asignar el rol al usuario.');
      }
      throw error;
    }
  }

  async update(actor: CurrentUser, targetEmail: string, payload: UserUpdate) {
    const target = targetEmail.trim().toLowerCase();
    const user = await this.db.transaction(async (manager) => {
      const current = await this.findForUpdate(manager, target);
      if (!current) throw new NotFoundError('No se encontró la cuenta.');
      if (target === actor.email) {
        throw new ForbiddenError('No puedes cambiar tu propia cuenta.');
      }
      if (isProtectedRole(current.roleKey) && !actor.isSuperadmin) {
        throw new ForbiddenError(PROTECTED_ACCOUNT);
      }
      if (payload.roleKey) {
        ensureAssignableRole(payload.roleKey, actor);
        // Los ajustes se hicieron sobre el rol anterior.
        if (current.roleKey !== payload.roleKey) {
          current.permissionOverrides = {};
        }
        current.roleKey = payload.roleKey;
      }
      if (typeof payload.active === 'boolean') current.active = payload.active;
      if (payload.active === false) {
        await endSessions(manager, { userEmail: target }, 'account_disabled');
      }
      return manager.save(current);
    });
    return toResponse(user);
  }

  async permissions(targetEmail: string) {
    const user = await this.db.manager.findOneBy(UserEntity, {
      email: targetEmail.trim().toLowerCase(),
    });
    if (!user) throw new NotFoundError('No se encontró la cuenta.');
    return permissionsResponse(user);
  }

  private async withEditablePermissions(
    actor: CurrentUser,
    targetEmail: string,
    change: (user: UserEntity) => Record<string, boolean>,
  ) {
    const target = targetEmail.trim().toLowerCase();
    const user = await this.db.transaction(async (manager) => {
      const current = await this.findForUpdate(manager, target);
      if (!current) throw new NotFoundError('No se encontró la cuenta.');
      if (target === actor.email) {
        throw new ForbiddenError('No puedes cambiar tu propia cuenta.');
      }
      if (!hasCustomPermissions(current.roleKey)) {
        throw new ForbiddenError(
          'Las cuentas administrativas no usan permisos individuales.',
        );
      }
      current.permissionOverrides = change(current);
      return manager.save(current);
    });
    return permissionsResponse(user);
  }

  setPermission(
    actor: CurrentUser,
    targetEmail: string,
    permission: string,
    enabled: boolean,
  ) {
    if (!CONFIGURABLE_PERMISSIONS.some(({ key }) => key === permission)) {
      throw new ValidationError('Ese permiso no se puede configurar.');
    }
    return this.withEditablePermissions(actor, targetEmail, (user) => {
      const { [permission]: _previous, ...others } = user.permissionOverrides;
      return roleHasPermission(user.roleKey, permission) === enabled
        ? others
        : { ...others, [permission]: enabled };
    });
  }

  resetPermissions(actor: CurrentUser, targetEmail: string) {
    return this.withEditablePermissions(actor, targetEmail, () => ({}));
  }

  /** La cuenta se conserva para el historial, pero ya no puede entrar. */
  async remove(actor: CurrentUser, targetEmail: string): Promise<void> {
    const target = targetEmail.trim().toLowerCase();
    await this.db.transaction(async (manager) => {
      const current = await this.findForUpdate(manager, target);
      if (!current) throw new NotFoundError('No se encontró la cuenta.');
      if (target === actor.email) {
        throw new ForbiddenError('No puedes eliminar tu propia cuenta.');
      }
      if (isProtectedRole(current.roleKey) && !actor.isSuperadmin) {
        throw new ForbiddenError(PROTECTED_ACCOUNT);
      }
      await endSessions(manager, { userEmail: target }, 'account_deleted');
      await manager.update(UserEntity, target, {
        active: false,
        deletedAt: new Date(),
        deletedBy: actor.email,
      });
    });
  }

  async resetPassword(actor: CurrentUser, targetEmail: string) {
    const target = targetEmail.trim().toLowerCase();
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const user = await this.db.transaction(async (manager) => {
      const current = await this.findForUpdate(manager, target);
      if (!current) throw new NotFoundError('No se encontró la cuenta.');
      if (target === actor.email) {
        throw new ForbiddenError('No puedes cambiar tu propia cuenta.');
      }
      if (isProtectedRole(current.roleKey) && !actor.isSuperadmin) {
        throw new ForbiddenError(PROTECTED_ACCOUNT);
      }
      await endSessions(manager, { userEmail: target }, 'password_reset');
      current.passwordHash = passwordHash;
      current.mustChangePassword = true;
      return manager.save(current);
    });
    return { ...toResponse(user), temporaryPassword };
  }
}
