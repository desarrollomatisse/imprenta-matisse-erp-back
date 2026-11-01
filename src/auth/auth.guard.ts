import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../common/errors';
import { PermissionKey } from '../domain/enums';
import { RATE_RULES, RateLimitService } from '../rate-limit/rate-limit.service';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './auth.decorators';
import { AuthService, NO_ACCESS } from './auth.service';
import { AppRequest } from './session';

/** Guard global: toda ruta exige sesión salvo las marcadas con `@Public()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AppRequest>();
    this.auth.enforceOrigin(request);
    const { user, denied } = await this.auth.resolveUser(
      request,
      http.getResponse<Response>(),
    );
    if (denied) throw new ForbiddenError(NO_ACCESS);
    if (!user) throw new UnauthorizedError('Inicia sesión para continuar.');
    await this.rateLimit.consume(`api:${user.email}`, RATE_RULES.apiByUser);
    if (user.mustChangePassword) {
      throw new ForbiddenError('Debes cambiar tu contraseña para continuar.');
    }

    const permissions = this.reflector.getAllAndOverride<PermissionKey[]>(
      PERMISSIONS_KEY,
      targets,
    );
    if (permissions && !permissions.some((key) => user.can(key))) {
      throw new ForbiddenError('No tienes permiso para realizar esta acción.');
    }
    request.currentUser = user;
    return true;
  }
}
