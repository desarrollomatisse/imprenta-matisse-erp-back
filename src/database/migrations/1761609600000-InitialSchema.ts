import { MigrationInterface, QueryRunner } from 'typeorm';

/** Esquema base de seis tablas. */
export class InitialSchema1761609600000 implements MigrationInterface {
  name = 'InitialSchema1761609600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        email text PRIMARY KEY,
        role_key text NOT NULL,
        active boolean NOT NULL DEFAULT TRUE,
        created_at timestamptz NOT NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS users_role_key_idx ON users (role_key)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS responsibles (
        id bigserial PRIMARY KEY,
        area text NOT NULL,
        name text NOT NULL,
        email text,
        active boolean NOT NULL DEFAULT TRUE,
        created_at timestamptz NOT NULL
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS responsibles_area_name_active_ci_idx
      ON responsibles (area, lower(name)) WHERE active`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS responsibles_area_email_active_ci_idx
      ON responsibles (area, lower(email)) WHERE active AND email IS NOT NULL`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id text PRIMARY KEY,
        number text NOT NULL CONSTRAINT orders_number_key UNIQUE,
        customer_name text NOT NULL,
        customer_phone text,
        customer_address text,
        product_family text NOT NULL,
        product_name text NOT NULL,
        specifications text NOT NULL DEFAULT '',
        quantity integer NOT NULL,
        due_date date NOT NULL,
        has_plate boolean NOT NULL DEFAULT FALSE,
        summary_status text NOT NULL,
        current_area text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (summary_status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS orders_current_area_idx ON orders (current_area)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS orders_due_date_idx ON orders (due_date)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS orders_updated_at_idx ON orders (updated_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS order_tasks (
        id text PRIMARY KEY,
        order_id text NOT NULL
          CONSTRAINT order_tasks_order_id_fkey
          REFERENCES orders (id) ON DELETE CASCADE,
        area text NOT NULL,
        status text NOT NULL,
        responsible_id bigint
          CONSTRAINT order_tasks_responsible_id_fkey
          REFERENCES responsibles (id) ON DELETE SET NULL,
        planned_quantity integer NOT NULL,
        completed_quantity integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS order_tasks_order_created_idx
      ON order_tasks (order_id, created_at)`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS order_tasks_status_idx ON order_tasks (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS order_tasks_area_idx ON order_tasks (area)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS order_tasks_responsible_idx
      ON order_tasks (responsible_id)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS order_events (
        id text PRIMARY KEY,
        order_id text NOT NULL
          CONSTRAINT order_events_order_id_fkey
          REFERENCES orders (id) ON DELETE CASCADE,
        text text NOT NULL,
        status text,
        target_area text,
        from_role text,
        target_role text,
        assignment_assignee text,
        assignment_area text,
        actor text NOT NULL,
        created_at timestamptz NOT NULL
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS order_events_order_created_idx
      ON order_events (order_id, created_at)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS order_attachments (
        id text PRIMARY KEY,
        order_id text NOT NULL
          CONSTRAINT order_attachments_order_id_fkey
          REFERENCES orders (id) ON DELETE CASCADE,
        event_id text
          CONSTRAINT order_attachments_event_id_fkey
          REFERENCES order_events (id) ON DELETE SET NULL,
        name text NOT NULL,
        mime_type text NOT NULL,
        web_view_link text NOT NULL,
        created_at timestamptz NOT NULL
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS order_attachments_order_idx
      ON order_attachments (order_id)`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS order_attachments_event_idx
      ON order_attachments (event_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS order_attachments`);
    await queryRunner.query(`DROP TABLE IF EXISTS order_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS order_tasks`);
    await queryRunner.query(`DROP TABLE IF EXISTS orders`);
    await queryRunner.query(`DROP TABLE IF EXISTS responsibles`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
