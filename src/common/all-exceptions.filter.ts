import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { auditContext } from '../audit/audit-context';
import { env } from '../config/env';
import {
  DATABASE_BUSY_DETAIL,
  INTERNAL_ERROR_DETAIL,
  isDatabaseBusy,
  RateLimitError,
} from './errors';

function detailFrom(error: HttpException): unknown {
  const body = error.getResponse();
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    return body.detail;
  }
  // Multer rechaza el archivo antes de llegar al servicio.
  if (error.getStatus() === 413) {
    const sizeMb = Math.max(
      1,
      Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024)),
    );
    return `Cada archivo debe pesar hasta ${sizeMb} MB.`;
  }
  return error.message;
}

/** Toda respuesta de error usa `{ detail }`, el contrato que espera el front. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const audit = auditContext();

    if (error instanceof HttpException && !response.headersSent) {
      if (error instanceof RateLimitError && error.retryAfterSeconds) {
        response.set('Retry-After', String(error.retryAfterSeconds));
      }
      const detail = detailFrom(error);
      if (audit) {
        audit.error =
          typeof detail === 'string' ? detail : JSON.stringify(detail);
      }
      response.status(error.getStatus()).json({ detail });
      return;
    }

    if (audit) audit.error = error instanceof Error ? error.message : 'Error';

    if (isDatabaseBusy(error) && !response.headersSent) {
      this.logger.warn(`Base ocupada en ${request.method} ${request.path}`);
      response.status(503).json({ detail: DATABASE_BUSY_DETAIL });
      return;
    }

    this.logger.error(
      `Error no controlado en ${request.method} ${request.path}`,
      error instanceof Error ? error.stack : undefined,
    );
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.status(500).json({ detail: INTERNAL_ERROR_DETAIL });
  }
}
