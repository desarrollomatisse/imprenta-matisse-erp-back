import { z } from 'zod';
import { MAX_RESPONSIBLE_NAME_LENGTH } from '../domain/constants';

export const responsibleCreateSchema = z.strictObject({
  area: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(MAX_RESPONSIBLE_NAME_LENGTH),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullish(),
});
export type ResponsibleCreate = z.infer<typeof responsibleCreateSchema>;

export const responsibleQuerySchema = z.object({ area: z.string().min(1) });
export type ResponsibleQuery = z.infer<typeof responsibleQuerySchema>;

export const responsibleIdSchema = z.coerce.number().int().positive();
