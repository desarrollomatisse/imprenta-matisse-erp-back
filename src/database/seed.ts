import { hashPassword } from '../domain/passwords';
import { ROLE_KEYS } from '../domain/roles';
import dataSource from './data-source';
import { assertTestSeedAllowed } from './seed-guard';

const SEED_EMAIL_DOMAIN = 'matisse.test';
const SEED_PASSWORD = '12345678';

/** Crea una cuenta por rol. Es idempotente: no toca cuentas ya existentes. */
async function seed(): Promise<void> {
  assertTestSeedAllowed();
  await dataSource.initialize();
  const passwordHash = await hashPassword(SEED_PASSWORD);
  try {
    for (const roleKey of ROLE_KEYS) {
      const email = `${roleKey}@${SEED_EMAIL_DOMAIN}`;
      const inserted: unknown[] = await dataSource.query(
        `INSERT INTO users
           (email, role_key, password_hash, must_change_password, active, created_at)
         VALUES ($1, $2, $3, FALSE, TRUE, now())
         ON CONFLICT (email) DO NOTHING
         RETURNING email`,
        [email, roleKey, passwordHash],
      );
      console.log(`${email}: ${inserted.length ? 'creada' : 'ya existía'}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
