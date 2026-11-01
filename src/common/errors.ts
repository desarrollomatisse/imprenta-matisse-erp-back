import { HttpException } from '@nestjs/common';

export const INTERNAL_ERROR_DETAIL =
  'Ocurrió un error interno. Intenta de nuevo o contacta a administración.';
export const DATABASE_BUSY_DETAIL =
  'El sistema está ocupado. Intenta de nuevo en unos segundos.';

class AppError extends HttpException {
  constructor(detail: string, status = 400) {
    super({ detail }, status);
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail: string) {
    super(detail, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(detail: string) {
    super(detail, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(detail: string) {
    super(detail, 404);
  }
}

export class ConflictError extends AppError {
  constructor(detail: string) {
    super(detail, 409);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(detail: string) {
    super(detail, 413);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(detail: string) {
    super(detail, 415);
  }
}

export class ValidationError extends AppError {
  constructor(detail: string) {
    super(detail, 422);
  }
}

export class RateLimitError extends AppError {
  constructor(
    detail: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(detail, 429);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(detail: string) {
    super(detail, 503);
  }
}

const UNIQUE_VIOLATION = '23505';
const LOCK_NOT_AVAILABLE = '55P03';
const QUERY_CANCELED = '57014';
const DEADLOCK_DETECTED = '40P01';

const databaseErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;

export const isUniqueViolation = (error: unknown) =>
  databaseErrorCode(error) === UNIQUE_VIOLATION;

/** La base deshizo la transacción por una espera o un bloqueo cruzado. */
export function isDatabaseBusy(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return (
    code === LOCK_NOT_AVAILABLE ||
    code === QUERY_CANCELED ||
    code === DEADLOCK_DETECTED
  );
}
