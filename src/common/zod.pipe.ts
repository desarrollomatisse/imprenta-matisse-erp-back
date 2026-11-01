import { HttpException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Valida con Zod y responde 422 con `detail: [{ msg, loc }]`. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new HttpException(
      {
        detail: result.error.issues.map((issue) => ({
          loc: issue.path,
          msg: issue.message,
        })),
      },
      422,
    );
  }
}
