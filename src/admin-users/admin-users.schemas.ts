import { z } from 'zod';
import { isKnownRole } from '../domain/roles';

const roleKey = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .refine(isKnownRole, 'El rol indicado no existe.');

export const userCreateSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  roleKey,
});
export type UserCreate = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z
  .strictObject({
    roleKey: roleKey.nullish(),
    active: z.boolean().nullish(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Indica el rol o el estado que quieres actualizar.',
  );
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export const permissionToggleSchema = z.strictObject({
  enabled: z.boolean(),
});
export type PermissionToggle = z.infer<typeof permissionToggleSchema>;
