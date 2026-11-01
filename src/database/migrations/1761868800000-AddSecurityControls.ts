import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cambio obligatorio de contraseña, contadores de rate limit compartidos entre
 * procesos e idempotencia al registrar órdenes.
 */
export class AddSecurityControls1761868800000 implements MigrationInterface {
  name = 'AddSecurityControls1761868800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN must_change_password boolean NOT NULL DEFAULT TRUE`);
    // Las cuentas de prueba del seed solo existen en desarrollo.
    await queryRunner.query(`
      UPDATE users SET must_change_password = FALSE
      WHERE email LIKE '%@matisse.test'`);

    await queryRunner.query(`
      CREATE TABLE rate_limits (
        key text PRIMARY KEY,
        hits integer NOT NULL,
        reset_at timestamptz NOT NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX rate_limits_reset_at_idx ON rate_limits (reset_at)`,
    );

    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN idempotency_key text`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX orders_idempotency_key_idx
      ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX orders_idempotency_key_idx`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN idempotency_key`);
    await queryRunner.query(`DROP TABLE rate_limits`);
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN must_change_password`,
    );
  }
}
