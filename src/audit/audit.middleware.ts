import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppRequest } from '../auth/session';
import { AuditContext, runInAuditContext } from './audit-context';
import { AuditService } from './audit.service';

const MAX_USER_AGENT_LENGTH = 300;

/** Abre el contexto de la petición y la registra cuando termina. */
@Injectable()
export class AuditMiddleware implements NestMiddleware {
  constructor(private readonly audit: AuditService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const context: AuditContext = {
      requestId: randomUUID(),
      ip: request.ip ?? null,
      userAgent:
        request.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      actor: null,
      actorRole: null,
      orderId: null,
      logRead: false,
      error: null,
    };
    (request as AppRequest).auditContext = context;
    const startedAt = Date.now();
    response.on('close', () => {
      void this.audit.recordRequest(
        request,
        response,
        context,
        Date.now() - startedAt,
      );
    });
    runInAuditContext(context, next);
  }
}
