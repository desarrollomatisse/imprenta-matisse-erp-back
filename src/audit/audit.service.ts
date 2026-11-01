import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { AuditLogEntity, OrderEntity } from '../database/entities';
import { AuditContext } from './audit-context';
import { AuditFilters } from './audit.schemas';

const BUSINESS_TIME_ZONE = 'America/Lima';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOGIN_PATH = '/auth/login';
const TOO_MANY_REQUESTS = 429;
const FIRST_ERROR_STATUS = 400;
const MAX_PAYLOAD_LENGTH = 4_000;
const SECRET_FIELD = /password|token|secret/i;
const ORDER_PATH = /^\/orders\/([^/]+)/;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? '[oculto]' : redact(item),
    ]),
  );
}

function payloadOf(request: Request): object | null {
  const body = request.body as unknown;
  if (typeof body !== 'object' || body === null) return null;
  if (Object.keys(body).length === 0) return null;
  const clean = redact(body) as object;
  return JSON.stringify(clean).length > MAX_PAYLOAD_LENGTH
    ? { truncated: true }
    : clean;
}

/** Los anónimos solo cuentan al entrar: de otro modo llenarían la bitácora. */
function isWorthRecording(
  request: Request,
  status: number,
  context: AuditContext,
): boolean {
  if (status === TOO_MANY_REQUESTS) return false;
  if (SAFE_METHODS.has(request.method)) return context.logRead;
  return context.actor !== null || request.path === LOGIN_PATH;
}

const toResponse = (entry: AuditLogEntity) => ({
  id: entry.id,
  at: entry.at.toISOString(),
  kind: entry.kind,
  actor: entry.actor ?? undefined,
  actorRole: entry.actorRole ?? undefined,
  ip: entry.ip ?? undefined,
  userAgent: entry.userAgent ?? undefined,
  requestId: entry.requestId ?? undefined,
  action: entry.action,
  entity: entry.entity,
  entityId: entry.entityId ?? undefined,
  orderId: entry.orderId ?? undefined,
  changed: entry.changed ?? undefined,
  before: entry.before ?? undefined,
  after: entry.after ?? undefined,
  payload: entry.payload ?? undefined,
  status: entry.status ?? undefined,
  durationMs: entry.durationMs ?? undefined,
  message: entry.message ?? undefined,
});

const likePattern = (value: string) =>
  `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DataSource) {}

  /** Corre al cerrar la respuesta: también deja huella de lo que se rechazó. */
  async recordRequest(
    request: Request,
    response: Response,
    context: AuditContext,
    durationMs: number,
  ): Promise<void> {
    const status = response.statusCode;
    if (!isWorthRecording(request, status, context)) return;
    try {
      await this.db.manager.insert(AuditLogEntity, {
        kind: 'request',
        actor: context.actor,
        actorRole: context.actorRole,
        ip: context.ip,
        userAgent: context.userAgent,
        requestId: context.requestId,
        action: request.method,
        entity: request.path,
        orderId: context.orderId ?? ORDER_PATH.exec(request.path)?.[1] ?? null,
        payload: payloadOf(request),
        status,
        durationMs,
        message: context.error,
      });
    } catch (error) {
      this.logger.error(`No se pudo registrar una petición: ${String(error)}`);
    }
  }

  /** Acepta el número de orden, también de una orden eliminada. */
  private async orderIdentifiers(order: string): Promise<string[]> {
    const found = await this.db.manager
      .createQueryBuilder(OrderEntity, 'o')
      .withDeleted()
      .where('o.id = :order OR o.number = :number', {
        order,
        number: order.toUpperCase(),
      })
      .getOne();
    return found ? [found.id, found.number] : [order];
  }

  async list(filters: AuditFilters) {
    const { limit, offset, actor, order, entity, kind, rejected, from, to } =
      filters;
    const query = this.db.manager
      .createQueryBuilder(AuditLogEntity, 'a')
      .orderBy('a.id', 'DESC')
      .limit(limit + 1)
      .offset(offset);
    if (actor) {
      query.andWhere('a.actor ILIKE :actor', { actor: likePattern(actor) });
    }
    if (order) {
      const orderIds = await this.orderIdentifiers(order);
      query.andWhere('a.orderId IN (:...orderIds)', { orderIds });
    }
    if (entity) query.andWhere('a.entity = :entity', { entity });
    if (kind) query.andWhere('a.kind = :kind', { kind });
    if (rejected) {
      query.andWhere('a.status >= :errorStatus', {
        errorStatus: FIRST_ERROR_STATUS,
      });
    }
    query.setParameter('timeZone', BUSINESS_TIME_ZONE);
    if (from) {
      query.andWhere(
        'a.at >= (CAST(:from AS date))::timestamp AT TIME ZONE :timeZone',
        { from },
      );
    }
    if (to) {
      query.andWhere(
        `a.at < (CAST(:to AS date) + 1)::timestamp AT TIME ZONE :timeZone`,
        { to },
      );
    }
    const entries = await query.getMany();
    return {
      entries: entries.slice(0, limit).map(toResponse),
      hasMore: entries.length > limit,
    };
  }
}
