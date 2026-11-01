import { MigrationInterface, QueryRunner } from 'typeorm';

/** Sesiones por dispositivo para renovar el JWT con un refresh token. */
export class CreateAuthSessions1761782400000 implements MigrationInterface {
  name = 'CreateAuthSessions1761782400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE auth_sessions (
        id text PRIMARY KEY,
        user_email text NOT NULL
          CONSTRAINT auth_sessions_user_email_fkey
          REFERENCES users (email) ON DELETE CASCADE,
        token_hash text NOT NULL,
        previous_token_hash text,
        remember boolean NOT NULL,
        rotated_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX auth_sessions_user_email_idx ON auth_sessions (user_email)`,
    );
    await queryRunner.query(
      `CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE auth_sessions`);
  }
}
