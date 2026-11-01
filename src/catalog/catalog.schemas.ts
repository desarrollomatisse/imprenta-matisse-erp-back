import { z } from 'zod';

const MAX_LABEL_LENGTH = 120;

const label = z.string().trim().min(1).max(MAX_LABEL_LENGTH);

export const catalogNodeSchema = z.strictObject({ label });
export type CatalogNode = z.infer<typeof catalogNodeSchema>;

export const catalogOptionSchema = z.strictObject({
  label,
  phrase: z.string().trim().max(MAX_LABEL_LENGTH).nullish(),
});
export type CatalogOptionInput = z.infer<typeof catalogOptionSchema>;
