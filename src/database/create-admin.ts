import { z } from 'zod';
import { SystemRole } from '../domain/enums';
import { generateTemporaryPassword, hashPassword } from '../domain/passwords';
import dataSource from './data-source';

/**
 * Crea o recupera una cuenta Superadministrador desde el servidor. Es la forma
 * de obtener el primer acceso en producción, donde los seeds están bloqueados.
 */
async function createAdmin(): Promise<void> {
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email())
    .parse(process.argv[2]);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO users
           (email, role_key, password_hash, must_change_password, active, created_at)
         VALUES ($1, $2, $3, TRUE, TRUE, now())
         ON CONFLICT (email) DO UPDATE SET
           role_key = EXCLUDED.role_key,
           password_hash = EXCLUDED.password_hash,
           must_change_password = TRUE,
           active = TRUE,
           deleted_at = NULL,
           deleted_by = NULL`,
        [email, SystemRole.SUPERADMIN, passwordHash],
      );
      await manager.query(
        `UPDATE auth_sessions
         SET deleted_at = now(), end_reason = 'password_reset'
         WHERE user_email = $1 AND deleted_at IS NULL`,
        [email],
      );
    });
    console.log(`Cuenta: ${email}`);
    console.log(`Contraseña temporal: ${temporaryPassword}`);
  } finally {
    await dataSource.destroy();
  }
}

createAdmin().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
