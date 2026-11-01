import { RateLimitError } from '../common/errors';

const WINDOW_MS = 60 * 60 * 1000;

/** Limita archivos por cuenta en la memoria de este proceso. */
export class UploadLimiter {
  private readonly events = new Map<string, number[]>();

  constructor(private readonly maxPerHour: number) {}

  check(email: string, count: number): void {
    const now = Date.now();
    for (const [key, times] of this.events) {
      const recent = times.filter((time) => now - time <= WINDOW_MS);
      if (recent.length > 0) this.events.set(key, recent);
      else this.events.delete(key);
    }
    const times = this.events.get(email) ?? [];
    if (times.length + count > this.maxPerHour) {
      throw new RateLimitError('Se alcanzó el límite temporal de archivos.');
    }
    this.events.set(email, [...times, ...Array<number>(count).fill(now)]);
  }
}
