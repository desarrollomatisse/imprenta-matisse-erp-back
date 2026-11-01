import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hashSync } from 'bcryptjs';
import type { Request, Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { identifyAuditActor } from '../audit/audit-context';
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '../common/errors';
import { env } from '../config/env';
import { AuthSessionEntity, UserEntity } from '../database/entities';
import { CurrentUser } from '../domain/current-user';
import { hashPassword, validateNewPassword } from '../domain/passwords';
import { PermissionGrant } from '../domain/permissions';
import { isAdministrator, isKnownRole } from '../domain/roles';
import { RATE_RULES, RateLimitService } from '../rate-limit/rate-limit.service';
import {
  clearTokens,
  endSessions,
  readAccessToken,
  readRefreshToken,
  writeAccessToken,
  writeRefreshToken,
} from './session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos.';
export const NO_ACCESS =
  'Tu cuenta no tiene acceso asignado. Contacta a administración.';

// Evita que el tiempo de respuesta revele si un correo existe.
const UNKNOWN_USER_HASH = hashSync('cuenta-inexistente', 10);

const REFRESH_SECRET_BYTES = 32;

type AccessClaims = { sub: string };

export type ResolvedUser = { user: CurrentUser | null; denied: boolean };

const toCurrentUser = (user: UserEntity) =>
  new CurrentUser(
    user.email,
    user.roleKey,
    user.active,
    user.mustChangePassword,
    user.permissionOverrides,
  );

const newSecret = () => randomBytes(REFRESH_SECRET_BYTES).toString('base64url');

const hashSecret = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');

const sessionExpiry = (remember: boolean, now: number) =>
  new Date(
    now + (remember ? env.REMEMBERED_SESSION_TTL_MS : env.SESSION_TTL_MS),
  );

function parseRefreshToken(token: string) {
  const [id, secret] = token.split('.');
  return id && secret ? { id, hash: hashSecret(secret) } : null;
}

function grantToResponse(grant: PermissionGrant) {
  const hasScope =
    grant.scopeType !== null ||
    grant.areas.length > 0 ||
    grant.targetAreas.length > 0;
  return {
    permission: grant.permission,
    scope: hasScope
      ? {
          type: grant.scopeType ?? undefined,
          areas: [...grant.areas].sort(),
          targetAreas: [...grant.targetAreas].sort(),
        }
      : undefined,
  };
}

export function buildAuthStatus(user: CurrentUser | null) {
  if (!user) {
    return {
      authenticated: false,
      permissions: [],
      administrator: false,
      superadmin: false,
      mustChangePassword: false,
    };
  }
  return {
    authenticated: true,
    email: user.email,
    role: { key: user.roleKey, name: user.roleName },
    permissions: [...user.grants]
      .sort((a, b) => a.permission.localeCompare(b.permission))
      .map(grantToResponse),
    administrator: isAdministrator(user.roleKey),
    superadmin: user.isSuperadmin,
    mustChangePassword: user.mustChangePassword,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DataSource,
    private readonly jwt: JwtService,
    private readonly rateLimit: RateLimitService,
  ) {}

  enforceOrigin(request: Request): void {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = (request.headers.origin ?? '').replace(/\/+$/, '');
    if (origin !== env.FRONTEND_ORIGIN) {
      throw new ForbiddenError('Origen de solicitud no permitido.');
    }
  }

  async loadCurrentUser(
    email: string,
    manager: EntityManager = this.db.manager,
  ): Promise<CurrentUser | null> {
    const user = await manager.findOneBy(UserEntity, { email });
    if (!user || !user.active || !isKnownRole(user.roleKey)) return null;
    return toCurrentUser(user);
  }

  async login(
    email: string,
    password: string,
    remember: boolean,
    ip: string,
    response: Response,
  ): Promise<CurrentUser> {
    // Se cuenta antes de comparar para que los intentos en paralelo no se cuelen.
    const shortKey = `login:short:${email}:${ip}`;
    const longKey = `login:long:${email}:${ip}`;
    await this.rateLimit.consume(`login:ip:${ip}`, RATE_RULES.loginByIp);
    await this.rateLimit.consume(shortKey, RATE_RULES.loginShort);
    await this.rateLimit.consume(longKey, RATE_RULES.loginLong);

    const user = await this.db.manager.findOneBy(UserEntity, { email });
    const valid = await compare(
      password,
      user?.passwordHash ?? UNKNOWN_USER_HASH,
    );
    if (!user || !valid) throw new UnauthorizedError(INVALID_CREDENTIALS);
    await this.rateLimit.reset([shortKey, longKey]);
    if (!user.active || !isKnownRole(user.roleKey)) {
      throw new ForbiddenError(NO_ACCESS);
    }

    await this.rateLimit.purgeExpired();
    const current = toCurrentUser(user);
    identifyAuditActor(current);
    await this.openSession(user.email, remember, response);
    return current;
  }

  /** Cierra los demás dispositivos: quien tuviera la clave anterior queda fuera. */
  async changePassword(
    user: CurrentUser,
    currentPassword: string,
    newPassword: string,
    request: Request,
    response: Response,
  ): Promise<CurrentUser> {
    if (newPassword === currentPassword) {
      throw new ValidationError('La contraseña nueva debe ser distinta.');
    }
    validateNewPassword(newPassword, user.email);
    const passwordHash = await hashPassword(newPassword);
    const token = readRefreshToken(request);
    const sessionId = token ? parseRefreshToken(token)?.id : undefined;
    const session = sessionId
      ? await this.db.manager.findOneBy(AuthSessionEntity, { id: sessionId })
      : null;

    await this.db.transaction(async (manager) => {
      const account = await manager
        .createQueryBuilder(UserEntity, 'u')
        .where('u.email = :email', { email: user.email })
        .setLock('pessimistic_write')
        .getOne();
      if (!account || !(await compare(currentPassword, account.passwordHash))) {
        throw new ValidationError('La contraseña actual no es correcta.');
      }
      await manager.update(UserEntity, user.email, {
        passwordHash,
        mustChangePassword: false,
      });
      await endSessions(manager, { userEmail: user.email }, 'password_changed');
    });
    await this.openSession(user.email, session?.remember ?? false, response);
    return new CurrentUser(
      user.email,
      user.roleKey,
      user.active,
      false,
      user.permissionOverrides,
    );
  }

  /** Identifica al usuario y renueva el acceso vencido con el refresh token. */
  async resolveUser(
    request: Request,
    response: Response,
  ): Promise<ResolvedUser> {
    const email = this.verifyAccess(readAccessToken(request));
    if (email) {
      const user = await this.loadCurrentUser(email);
      if (user) {
        identifyAuditActor(user);
        return { user, denied: false };
      }
      await this.logout(request, response);
      return { user: null, denied: true };
    }

    const refreshToken = readRefreshToken(request);
    if (!refreshToken) return { user: null, denied: false };
    const user = await this.renew(refreshToken, response);
    if (user) identifyAuditActor(user);
    else clearTokens(response);
    return { user, denied: false };
  }

  async logout(request: Request, response: Response): Promise<void> {
    const token = readRefreshToken(request);
    const parsed = token ? parseRefreshToken(token) : null;
    const session = parsed
      ? await this.db.manager.findOneBy(AuthSessionEntity, {
          id: parsed.id,
          tokenHash: parsed.hash,
        })
      : null;
    if (session) {
      identifyAuditActor({ email: session.userEmail });
      await this.db.transaction((manager) =>
        endSessions(manager, { id: session.id }, 'logout'),
      );
    }
    clearTokens(response);
  }

  private async openSession(
    email: string,
    remember: boolean,
    response: Response,
  ): Promise<void> {
    const now = Date.now();
    const id = randomUUID();
    const secret = newSecret();
    await this.db.transaction((manager) =>
      manager.insert(AuthSessionEntity, {
        id,
        userEmail: email,
        tokenHash: hashSecret(secret),
        previousTokenHash: null,
        remember,
        rotatedAt: new Date(now),
        expiresAt: sessionExpiry(remember, now),
        createdAt: new Date(now),
      }),
    );
    this.writeAccess(response, email);
    writeRefreshToken(response, `${id}.${secret}`, remember);
  }

  private writeAccess(response: Response, email: string): void {
    writeAccessToken(response, this.jwt.sign({ sub: email }));
  }

  private verifyAccess(token: string | null): string | null {
    if (!token) return null;
    try {
      return this.jwt.verify<AccessClaims>(token).sub;
    } catch {
      return null;
    }
  }

  /**
   * Rota el refresh token como máximo una vez por intervalo para que una
   * respuesta perdida en mala señal no deje al usuario fuera. El token anterior
   * sigue valiendo un momento por las peticiones simultáneas; pasado ese margen,
   * reutilizarlo indica una copia robada y cierra la sesión.
   */
  private async renew(
    token: string,
    response: Response,
  ): Promise<CurrentUser | null> {
    const parsed = parseRefreshToken(token);
    if (!parsed) return null;

    // Si la sesión termina aquí, la bitácora debe saber de quién era.
    const owner = await this.db.manager.findOneBy(AuthSessionEntity, {
      id: parsed.id,
    });
    if (owner) identifyAuditActor({ email: owner.userEmail });

    return this.db.transaction(async (manager) => {
      const session = await manager
        .createQueryBuilder(AuthSessionEntity, 's')
        .where('s.id = :id', { id: parsed.id })
        .setLock('pessimistic_write')
        .getOne();
      if (!session) return null;

      const now = Date.now();
      const sinceRotation = now - session.rotatedAt.getTime();
      const isCurrent = parsed.hash === session.tokenHash;
      const isRecentPrevious =
        parsed.hash === session.previousTokenHash &&
        sinceRotation < env.REFRESH_REUSE_GRACE_MS;
      const user =
        (isCurrent || isRecentPrevious) && session.expiresAt.getTime() > now
          ? await this.loadCurrentUser(session.userEmail, manager)
          : null;
      if (!user) {
        const known = isCurrent || isRecentPrevious;
        await endSessions(
          manager,
          { id: session.id },
          known ? 'expired' : 'token_reused',
        );
        return null;
      }

      const expiresAt = sessionExpiry(session.remember, now);
      if (!isCurrent) {
        await manager.update(AuthSessionEntity, session.id, { expiresAt });
      } else if (sinceRotation < env.REFRESH_ROTATION_INTERVAL_MS) {
        await manager.update(AuthSessionEntity, session.id, { expiresAt });
        writeRefreshToken(response, token, session.remember);
      } else {
        const secret = newSecret();
        await manager.update(AuthSessionEntity, session.id, {
          tokenHash: hashSecret(secret),
          previousTokenHash: session.tokenHash,
          rotatedAt: new Date(now),
          expiresAt,
        });
        writeRefreshToken(
          response,
          `${session.id}.${secret}`,
          session.remember,
        );
      }
      this.writeAccess(response, user.email);
      return user;
    });
  }
}
