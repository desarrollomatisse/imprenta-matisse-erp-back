import { PermissionKey, SystemRole } from './enums';
import { effectiveGrants, PermissionGrant } from './permissions';
import { ROLE_NAMES } from './roles';

export class CurrentUser {
  readonly roleName: string;
  readonly isSuperadmin: boolean;
  readonly grants: readonly PermissionGrant[];
  private readonly grantsByKey: Map<string, PermissionGrant>;

  constructor(
    readonly email: string,
    readonly roleKey: string,
    readonly active: boolean,
    readonly mustChangePassword: boolean,
    readonly permissionOverrides: Record<string, boolean>,
  ) {
    this.roleName = ROLE_NAMES[roleKey] ?? roleKey;
    this.isSuperadmin = roleKey === SystemRole.SUPERADMIN;
    this.grants = effectiveGrants(roleKey, permissionOverrides);
    this.grantsByKey = new Map(
      this.grants.map((grant) => [grant.permission, grant]),
    );
  }

  grant(permission: PermissionKey): PermissionGrant | undefined {
    return this.grantsByKey.get(permission);
  }

  can(permission: PermissionKey): boolean {
    return this.grantsByKey.has(permission);
  }
}
