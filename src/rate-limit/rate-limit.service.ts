import { Injectable } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';
import { RateLimitError } from '../common/errors';
import { RateLimitEntity } from '../database/entities';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export type RateRule = { limit: number; windowMs: number };

export const RATE_RULES = {
  loginByIp: { limit: 20, windowMs: 15 * MINUTE_MS },
  // Dos ventanas para que la espera crezca si el ataque continúa.
  loginShort: { limit: 5, windowMs: 15 * MINUTE_MS },
  loginLong: { limit: 15, windowMs: 24 * HOUR_MS },
  tracking: { limit: 30, windowMs: MINUTE_MS },
  apiByUser: { limit: 300, windowMs: MINUTE_MS },
  passwordChange: { limit: 5, windowMs: HOUR_MS },
} satisfies Record<string, RateRule>;

type CounterRow = { hits: number; reset_at: Date };

/**
 * Contadores en PostgreSQL: son compartidos entre procesos y sobreviven a un
 * reinicio. El incremento es atómico, así que las peticiones paralelas no
 * pueden colarse entre la consulta y la escritura.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly db: DataSource) {}

  async consume(key: string, rule: RateRule): Promise<void> {
    const rows: CounterRow[] = await this.db.query(
      `INSERT INTO rate_limits (key, hits, reset_at)
       VALUES ($1, 1, now() + ($2::double precision * interval '1 millisecond'))
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limits.reset_at <= now()
           THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= now()
           THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [key, rule.windowMs],
    );
    const { hits, reset_at: resetAt } = rows[0];
    if (hits <= rule.limit) return;

    const seconds = Math.max(
      1,
      Math.ceil((resetAt.getTime() - Date.now()) / 1000),
    );
    const minutes = Math.ceil(seconds / 60);
    throw new RateLimitError(
      `Demasiados intentos. Espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.`,
      seconds,
    );
  }

  async reset(keys: string[]): Promise<void> {
    await this.db.manager.delete(RateLimitEntity, keys);
  }

  async purgeExpired(): Promise<void> {
    await this.db.manager.delete(RateLimitEntity, {
      resetAt: LessThan(new Date()),
    });
  }
}
