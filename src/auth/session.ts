import type { CookieOptions, Request, Response } from 'express';
import { EntityManager, FindOptionsWhere, IsNull } from 'typeorm';
import { AuditContext } from '../audit/audit-context';
import { env } from '../config/env';
import { AuthSessionEntity } from '../database/entities';
import { CurrentUser } from '../domain/current-user';

export type AppRequest = Request & {
  currentUser?: CurrentUser;
  auditContext?: AuditContext;
};

const ACCESS_COOKIE = 'matisse_access';
const REFRESH_COOKIE = 'matisse_refresh';

// Ambas viajan por /api: el navegador las envía también en <img> y descargas,
// que no pueden reintentar una petición después de renovar la sesión.
const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.COOKIE_SECURE,
  path: '/api',
};

function readCookie(request: Request, name: string): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value ? value : null;
}

export const readAccessToken = (request: Request) =>
  readCookie(request, ACCESS_COOKIE);

export const readRefreshToken = (request: Request) =>
  readCookie(request, REFRESH_COOKIE);

export function writeAccessToken(response: Response, token: string): void {
  response.cookie(ACCESS_COOKIE, token, {
    ...cookieOptions,
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
}

/** Sin `remember` es una cookie de sesión: termina al cerrar el navegador. */
export function writeRefreshToken(
  response: Response,
  token: string,
  remember: boolean,
): void {
  response.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions,
    ...(remember ? { maxAge: env.REMEMBERED_SESSION_TTL_MS } : {}),
  });
}

export function clearTokens(response: Response): void {
  response.clearCookie(ACCESS_COOKIE, cookieOptions);
  response.clearCookie(REFRESH_COOKIE, cookieOptions);
}

/** La sesión deja de valer, pero queda el registro de cuándo y por qué. */
export async function endSessions(
  manager: EntityManager,
  where: FindOptionsWhere<AuthSessionEntity>,
  reason: string,
): Promise<void> {
  await manager.update(
    AuthSessionEntity,
    { ...where, deletedAt: IsNull() },
    { deletedAt: new Date(), endReason: reason },
  );
}
