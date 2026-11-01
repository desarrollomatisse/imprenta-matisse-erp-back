import { MigrationInterface, QueryRunner } from 'typeorm';

/** Permisos agregados o quitados a una cuenta sobre los que da su rol. */
export class AddPermissionOverrides1762041600000 implements MigrationInterface {
  name = 'AddPermissionOverrides1762041600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN permission_overrides jsonb NOT NULL DEFAULT '{}'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN permission_overrides`,
    );
  }
}
