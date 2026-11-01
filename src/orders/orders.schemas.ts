import { z } from 'zod';
import {
  MAX_ADDRESS_LENGTH,
  MAX_ATTACHMENTS_PER_EVENT,
  MAX_INCIDENT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_PRODUCT_FAMILY_LENGTH,
  MAX_PRODUCT_NAME_LENGTH,
  MAX_QUANTITY,
  MAX_SPECIFICATIONS_LENGTH,
  PAGE_DEFAULT,
  PAGE_MAX,
} from '../domain/constants';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});
export type Page = z.infer<typeof pageSchema>;

export const orderCreateSchema = z.strictObject({
  customer: z.strictObject({
    name: text(MAX_NAME_LENGTH),
    phone: optionalText(MAX_PHONE_LENGTH),
    deliveryAddress: optionalText(MAX_ADDRESS_LENGTH),
  }),
  product: z.strictObject({
    family: text(MAX_PRODUCT_FAMILY_LENGTH).default('other'),
    name: text(MAX_PRODUCT_NAME_LENGTH),
    specifications: z
      .string()
      .trim()
      .max(MAX_SPECIFICATIONS_LENGTH)
      .default(''),
  }),
  quantity: z.number().int().positive().max(MAX_QUANTITY),
  dueDate: z.iso.date(),
  hasPlate: z.boolean().default(false),
  initialAssignee: text(MAX_NAME_LENGTH),
});
export type OrderCreate = z.infer<typeof orderCreateSchema>;

export const idempotencyKeySchema = z
  .string({ error: 'Falta el encabezado Idempotency-Key.' })
  .regex(/^[A-Za-z0-9_-]{16,128}$/, 'Idempotency-Key no es válido.');

/** Versión de la orden que veía quien actúa, enviada en `If-Match`. */
export const orderVersionSchema = z
  .string({ error: 'Falta el encabezado If-Match con la versión de la orden.' })
  .regex(/^[1-9]\d{0,8}$/, 'If-Match no es válido.')
  .transform(Number);

export const orderUpdateSchema = z
  .strictObject({
    dueDate: z.iso.date().nullish(),
    hasPlate: z.boolean().nullish(),
    details: optionalText(MAX_SPECIFICATIONS_LENGTH),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Indica al menos un campo para actualizar.',
  );
export type OrderUpdate = z.infer<typeof orderUpdateSchema>;

const attachmentInputSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{5,200}$/),
  name: optionalText(MAX_NAME_LENGTH),
  mimeType: optionalText(100),
  webViewLink: optionalText(500),
});
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export const orderAssignSchema = z.strictObject({
  status: text(40),
  area: text(40),
  assignee: text(MAX_NAME_LENGTH),
  incidentDescription: optionalText(MAX_INCIDENT_LENGTH),
  attachments: z
    .array(attachmentInputSchema)
    .max(MAX_ATTACHMENTS_PER_EVENT)
    .default([]),
});
export type OrderAssign = z.infer<typeof orderAssignSchema>;

export const attachmentRequestSchema = z.strictObject({
  attachments: z
    .array(attachmentInputSchema)
    .min(1)
    .max(MAX_ATTACHMENTS_PER_EVENT),
});
export type AttachmentRequest = z.infer<typeof attachmentRequestSchema>;

export const orderCancelSchema = z.strictObject({
  reason: text(MAX_INCIDENT_LENGTH),
});
export type OrderCancel = z.infer<typeof orderCancelSchema>;

export const orderReactivateSchema = z.strictObject({
  reason: text(MAX_INCIDENT_LENGTH),
});
export type OrderReactivate = z.infer<typeof orderReactivateSchema>;

export const noteCreateSchema = z.strictObject({
  text: text(MAX_NOTE_LENGTH),
});
export type NoteCreate = z.infer<typeof noteCreateSchema>;

export const incidentCreateSchema = z.strictObject({
  description: text(MAX_INCIDENT_LENGTH),
});
export type IncidentCreate = z.infer<typeof incidentCreateSchema>;
