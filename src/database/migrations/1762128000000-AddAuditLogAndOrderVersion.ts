import { MigrationInterface, QueryRunner } from 'typeorm';

// Tablas con historial completo y columnas que nunca se copian a la bitácora.
const AUDITED_TABLES: Record<string, string[]> = {
  users: ['password_hash'],
  responsibles: [],
  orders: ['idempotency_key'],
  order_tasks: [],
  order_events: [],
  order_attachments: [],
  catalog_families: [],
  catalog_products: [],
  catalog_questions: [],
  catalog_options: [],
};

const SESSION_SECRETS = `'token_hash', 'previous_token_hash'`;
const UNDELETABLE_TABLES = [...Object.keys(AUDITED_TABLES), 'auth_sessions'];

const quoted = (columns: string[]) =>
  columns.map((column) => `'${column}'`).join(', ');

/**
 * Bitácora de solo agregado escrita por triggers: ningún cambio depende de que
 * el código se acuerde de registrarlo y ninguna fila se puede borrar.
 */
export class AddAuditLogAndOrderVersion1762128000000 implements MigrationInterface {
  name = 'AddAuditLogAndOrderVersion1762128000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE orders
        ADD COLUMN version integer NOT NULL DEFAULT 1,
        ADD COLUMN cancelled_from_status text,
        ADD COLUMN cancelled_from_area text`);
    await queryRunner.query(
      `ALTER TABLE order_tasks ADD COLUMN cancelled_from_status text`,
    );
    await queryRunner.query(`
      ALTER TABLE auth_sessions
        ADD COLUMN deleted_at timestamptz,
        ADD COLUMN end_reason text`);

    // Las órdenes ya canceladas también deben poder volver a donde estaban.
    await queryRunner.query(`
      UPDATE orders o
      SET cancelled_from_status = COALESCE(previous.status, 'design'),
          cancelled_from_area = COALESCE(previous.target_area, 'design')
      FROM orders c
      LEFT JOIN LATERAL (
        SELECT e.status, e.target_area
        FROM order_events e
        WHERE e.order_id = c.id
          AND e.status IS NOT NULL
          AND e.status <> 'cancelled'
        ORDER BY e.created_at DESC
        LIMIT 1
      ) previous ON TRUE
      WHERE o.id = c.id AND c.summary_status = 'cancelled'`);
    await queryRunner.query(`
      UPDATE order_tasks t
      SET cancelled_from_status = 'pending'
      FROM orders o
      WHERE o.id = t.order_id
        AND o.summary_status = 'cancelled'
        AND t.status = 'cancelled'`);

    await queryRunner.query(`
      CREATE TABLE audit_log (
        id bigint GENERATED ALWAYS AS IDENTITY,
        at timestamptz NOT NULL DEFAULT clock_timestamp(),
        kind text NOT NULL,
        actor text,
        actor_role text,
        ip text,
        user_agent text,
        request_id text,
        action text NOT NULL,
        entity text NOT NULL,
        entity_id text,
        order_id text,
        changed text[],
        before jsonb,
        after jsonb,
        payload jsonb,
        status integer,
        duration_ms integer,
        message text,
        CONSTRAINT audit_log_pkey PRIMARY KEY (id)
      )`);
    await queryRunner.query(`CREATE INDEX audit_log_at_idx ON audit_log (at)`);
    await queryRunner.query(
      `CREATE INDEX audit_log_actor_idx ON audit_log (actor, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX audit_log_order_idx ON audit_log (order_id, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX audit_log_request_idx ON audit_log (request_id)`,
    );

    await queryRunner.query(`
      CREATE FUNCTION audit_row_change() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        old_row jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
        new_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
        row_data jsonb := COALESCE(new_row, old_row);
        operation text := TG_OP;
        changed_columns text[];
        request_id text := NULLIF(current_setting('app.request_id', TRUE), '');
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          -- La versión solo acompaña a un cambio real de la misma operación.
          SELECT array_agg(n.key ORDER BY n.key) INTO changed_columns
          FROM jsonb_each(new_row) AS n(key, value)
          WHERE n.key <> 'version' AND n.value IS DISTINCT FROM old_row -> n.key;
          IF changed_columns IS NULL THEN
            RETURN NULL;
          END IF;
          IF old_row ->> 'deleted_at' IS NULL AND new_row ->> 'deleted_at' IS NOT NULL THEN
            operation := 'SOFT_DELETE';
          ELSIF old_row ->> 'deleted_at' IS NOT NULL AND new_row ->> 'deleted_at' IS NULL THEN
            operation := 'RESTORE';
          END IF;
        END IF;

        INSERT INTO audit_log (
          kind, actor, actor_role, ip, user_agent, request_id,
          action, entity, entity_id, order_id, changed, before, after
        ) VALUES (
          'change',
          -- Sin petición de la API, el cambio vino de un comando o de SQL directo.
          COALESCE(
            NULLIF(current_setting('app.actor', TRUE), ''),
            CASE WHEN request_id IS NULL THEN 'sistema:' || current_user END
          ),
          NULLIF(current_setting('app.actor_role', TRUE), ''),
          NULLIF(current_setting('app.ip', TRUE), ''),
          NULLIF(current_setting('app.user_agent', TRUE), ''),
          request_id,
          operation,
          TG_TABLE_NAME,
          COALESCE(row_data ->> 'id', row_data ->> 'email'),
          CASE WHEN TG_TABLE_NAME = 'orders'
            THEN row_data ->> 'id'
            ELSE row_data ->> 'order_id'
          END,
          changed_columns,
          old_row - TG_ARGV,
          new_row - TG_ARGV
        );
        RETURN NULL;
      END;
      $$`);

    await queryRunner.query(`
      CREATE FUNCTION forbid_change() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '% no está permitido en %: los datos no se borran.',
          TG_OP, TG_TABLE_NAME;
      END;
      $$`);

    for (const [table, secrets] of Object.entries(AUDITED_TABLES)) {
      await queryRunner.query(`
        CREATE TRIGGER ${table}_audit
        AFTER INSERT OR UPDATE ON ${table}
        FOR EACH ROW EXECUTE PROCEDURE audit_row_change(${quoted(secrets)})`);
    }

    // Cada renovación toca la sesión: solo interesan su inicio y su final.
    await queryRunner.query(`
      CREATE TRIGGER auth_sessions_audit_start
      AFTER INSERT ON auth_sessions
      FOR EACH ROW EXECUTE PROCEDURE audit_row_change(${SESSION_SECRETS})`);
    await queryRunner.query(`
      CREATE TRIGGER auth_sessions_audit_end
      AFTER UPDATE ON auth_sessions
      FOR EACH ROW
      WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
      EXECUTE PROCEDURE audit_row_change(${SESSION_SECRETS})`);

    for (const table of UNDELETABLE_TABLES) {
      await queryRunner.query(`
        CREATE TRIGGER ${table}_no_delete
        BEFORE DELETE ON ${table}
        FOR EACH ROW EXECUTE PROCEDURE forbid_change()`);
      await queryRunner.query(`
        CREATE TRIGGER ${table}_no_truncate
        BEFORE TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE PROCEDURE forbid_change()`);
    }

    await queryRunner.query(`
      CREATE TRIGGER audit_log_append_only
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE PROCEDURE forbid_change()`);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_no_truncate
      BEFORE TRUNCATE ON audit_log
      FOR EACH STATEMENT EXECUTE PROCEDURE forbid_change()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE audit_log`);
    for (const table of UNDELETABLE_TABLES) {
      await queryRunner.query(`DROP TRIGGER ${table}_no_delete ON ${table}`);
      await queryRunner.query(`DROP TRIGGER ${table}_no_truncate ON ${table}`);
    }
    for (const table of Object.keys(AUDITED_TABLES)) {
      await queryRunner.query(`DROP TRIGGER ${table}_audit ON ${table}`);
    }
    await queryRunner.query(
      `DROP TRIGGER auth_sessions_audit_start ON auth_sessions`,
    );
    await queryRunner.query(
      `DROP TRIGGER auth_sessions_audit_end ON auth_sessions`,
    );
    await queryRunner.query(`DROP FUNCTION audit_row_change()`);
    await queryRunner.query(`DROP FUNCTION forbid_change()`);
    await queryRunner.query(`
      ALTER TABLE auth_sessions
        DROP COLUMN deleted_at,
        DROP COLUMN end_reason`);
    await queryRunner.query(
      `ALTER TABLE order_tasks DROP COLUMN cancelled_from_status`,
    );
    await queryRunner.query(`
      ALTER TABLE orders
        DROP COLUMN version,
        DROP COLUMN cancelled_from_status,
        DROP COLUMN cancelled_from_area`);
  }
}
