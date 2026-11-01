import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { ValidationError } from '../common/errors';

const BCRYPT_ROUNDS = 10;
const TEMPORARY_PASSWORD_BYTES = 12;

export const MIN_PASSWORD_LENGTH = 10;
// bcrypt ignora lo que pase de 72 bytes.
export const MAX_PASSWORD_BYTES = 72;

export const hashPassword = (password: string) => hash(password, BCRYPT_ROUNDS);

/** Contraseña de un solo uso: la cuenta debe cambiarla al entrar. */
export const generateTemporaryPassword = () =>
  randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');

export function validateNewPassword(password: string, email: string): void {
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new ValidationError('La contraseña es demasiado larga.');
  }
  const normalized = password.toLowerCase();
  const account = email.split('@')[0].toLowerCase();
  if (
    /^\d+$/.test(password) ||
    /^(.)\1+$/.test(password) ||
    normalized.includes('matisse') ||
    normalized.includes(account)
  ) {
    throw new ValidationError(
      'Elige una contraseña más difícil: no uses solo números, tu correo ni el nombre de la empresa.',
    );
  }
}
