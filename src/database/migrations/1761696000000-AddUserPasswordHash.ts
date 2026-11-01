import { hashSync } from 'bcryptjs';
import { MigrationInterface, QueryRunner } from 'typeorm';

const INITIAL_PASSWORD = '12345678';
const BCRYPT_ROUNDS = 10;

/** El acceso pasa a correo y contraseña: toda cuenta existente recibe la inicial. */
export class AddUserPasswordHash1761696000000 implements MigrationInterface {
  name = 'AddUserPasswordHash1761696000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN password_hash text`);
    await queryRunner.query(`UPDATE users SET password_hash = $1`, [
      hashSync(INITIAL_PASSWORD, BCRYPT_ROUNDS),
    ]);
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN password_hash`);
  }
}
