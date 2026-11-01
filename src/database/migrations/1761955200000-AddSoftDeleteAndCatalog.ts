import { randomUUID } from 'node:crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';
import catalog from '../../domain/product-catalog.json';

const SOFT_DELETE_COLUMNS = `
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by text`;

/** Borrado lógico y catálogo editable, cargado con el catálogo que ya existía. */
export class AddSoftDeleteAndCatalog1761955200000 implements MigrationInterface {
  name = 'AddSoftDeleteAndCatalog1761955200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['users', 'orders', 'order_attachments']) {
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD COLUMN deleted_at timestamptz,
        ADD COLUMN deleted_by text`);
    }

    await queryRunner.query(`
      CREATE TABLE catalog_families (
        id text PRIMARY KEY,
        label text NOT NULL,
        position integer NOT NULL DEFAULT 0,
        ${SOFT_DELETE_COLUMNS}
      )`);
    await queryRunner.query(`
      CREATE TABLE catalog_products (
        id text PRIMARY KEY,
        family_id text NOT NULL
          CONSTRAINT catalog_products_family_id_fkey
          REFERENCES catalog_families (id),
        label text NOT NULL,
        position integer NOT NULL DEFAULT 0,
        ${SOFT_DELETE_COLUMNS}
      )`);
    await queryRunner.query(`
      CREATE TABLE catalog_questions (
        id text PRIMARY KEY,
        product_id text NOT NULL
          CONSTRAINT catalog_questions_product_id_fkey
          REFERENCES catalog_products (id),
        label text NOT NULL,
        position integer NOT NULL DEFAULT 0,
        ${SOFT_DELETE_COLUMNS}
      )`);
    await queryRunner.query(`
      CREATE TABLE catalog_options (
        id text PRIMARY KEY,
        question_id text NOT NULL
          CONSTRAINT catalog_options_question_id_fkey
          REFERENCES catalog_questions (id),
        label text NOT NULL,
        phrase text NOT NULL,
        position integer NOT NULL DEFAULT 0,
        ${SOFT_DELETE_COLUMNS}
      )`);

    // Evitan duplicados entre lo vigente, también con peticiones simultáneas.
    await queryRunner.query(`
      CREATE UNIQUE INDEX catalog_families_label_idx
      ON catalog_families (lower(label)) WHERE deleted_at IS NULL`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX catalog_products_label_idx
      ON catalog_products (family_id, lower(label)) WHERE deleted_at IS NULL`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX catalog_questions_label_idx
      ON catalog_questions (product_id, lower(label)) WHERE deleted_at IS NULL`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX catalog_options_label_idx
      ON catalog_options (question_id, lower(label)) WHERE deleted_at IS NULL`);

    for (const [familyIndex, family] of catalog.entries()) {
      await queryRunner.query(
        `INSERT INTO catalog_families (id, label, position) VALUES ($1, $2, $3)`,
        [family.id, family.label, familyIndex],
      );
      for (const [productIndex, product] of family.products.entries()) {
        await queryRunner.query(
          `INSERT INTO catalog_products (id, family_id, label, position)
           VALUES ($1, $2, $3, $4)`,
          [product.id, family.id, product.label, productIndex],
        );
        for (const [questionIndex, question] of product.questions.entries()) {
          const questionId = randomUUID();
          await queryRunner.query(
            `INSERT INTO catalog_questions (id, product_id, label, position)
             VALUES ($1, $2, $3, $4)`,
            [questionId, product.id, question.label, questionIndex],
          );
          for (const [optionIndex, option] of question.options.entries()) {
            await queryRunner.query(
              `INSERT INTO catalog_options
                 (id, question_id, label, phrase, position)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                randomUUID(),
                questionId,
                option.label,
                option.phrase,
                optionIndex,
              ],
            );
          }
        }
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE catalog_options`);
    await queryRunner.query(`DROP TABLE catalog_questions`);
    await queryRunner.query(`DROP TABLE catalog_products`);
    await queryRunner.query(`DROP TABLE catalog_families`);
    for (const table of ['users', 'orders', 'order_attachments']) {
      await queryRunner.query(`
        ALTER TABLE ${table}
        DROP COLUMN deleted_at,
        DROP COLUMN deleted_by`);
    }
  }
}
