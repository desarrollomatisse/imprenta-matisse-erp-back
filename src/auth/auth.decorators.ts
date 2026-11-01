import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { CurrentUser } from '../domain/current-user';
import { PermissionKey } from '../domain/enums';
import { AppRequest } from './session';

export const PUBLIC_KEY = 'auth:public';
export const PERMISSIONS_KEY = 'auth:permissions';

/** La ruta no exige sesión. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Exige al menos uno de los permisos indicados. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const User = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUser =>
    context.switchToHttp().getRequest<AppRequest>().currentUser as CurrentUser,
);
