import { z } from 'zod';

const MAX_AUDIT_PAGE = 500;
const DEFAULT_AUDIT_PAGE = 100;
const MAX_FILTER_LENGTH = 120;

const filter = z.string().trim().min(1).max(MAX_FILTER_LENGTH).optional();

export const auditFiltersSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_AUDIT_PAGE)
    .default(DEFAULT_AUDIT_PAGE),
  offset: z.coerce.number().int().min(0).default(0),
  actor: filter,
  order: filter,
  entity: filter,
  kind: z.enum(['change', 'request']).optional(),
  rejected: z.enum(['true']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;
