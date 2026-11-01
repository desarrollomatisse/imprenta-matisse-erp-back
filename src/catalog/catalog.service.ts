import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import {
  ConflictError,
  isUniqueViolation,
  NotFoundError,
} from '../common/errors';
import {
  CatalogFamilyEntity,
  CatalogOptionEntity,
  CatalogProductEntity,
  CatalogQuestionEntity,
} from '../database/entities';
import { CatalogOptionInput } from './catalog.schemas';

const NEW_ITEM_POSITION = 1_000_000;
const CATALOG_NOT_FOUND = 'No se encontró ese elemento del catálogo.';
const DUPLICATE_LABEL = 'Ya existe un elemento con ese nombre.';

type Node = { id: string };
type SortOrder = { position: 'ASC'; createdAt: 'ASC' };
const ORDER: SortOrder = { position: 'ASC', createdAt: 'ASC' };

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

const toOption = (option: CatalogOptionEntity) => ({
  value: option.id,
  label: option.label,
  phrase: option.phrase,
});

@Injectable()
export class CatalogService {
  constructor(private readonly db: DataSource) {}

  async tree() {
    const manager = this.db.manager;
    const [families, products, questions, options] = await Promise.all([
      manager.find(CatalogFamilyEntity, { order: ORDER }),
      manager.find(CatalogProductEntity, { order: ORDER }),
      manager.find(CatalogQuestionEntity, { order: ORDER }),
      manager.find(CatalogOptionEntity, { order: ORDER }),
    ]);
    const optionsByQuestion = groupBy(options, (item) => item.questionId);
    const questionsByProduct = groupBy(questions, (item) => item.productId);
    const productsByFamily = groupBy(products, (item) => item.familyId);

    return families.map((family) => ({
      id: family.id,
      label: family.label,
      products: (productsByFamily.get(family.id) ?? []).map((product) => ({
        id: product.id,
        label: product.label,
        questions: (questionsByProduct.get(product.id) ?? []).map(
          (question) => ({
            id: question.id,
            label: question.label,
            options: (optionsByQuestion.get(question.id) ?? []).map(toOption),
          }),
        ),
      })),
    }));
  }

  private async ensureParent<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: string,
  ): Promise<void> {
    const parent = await this.db.manager
      .getRepository(entity)
      .createQueryBuilder('n')
      .where('n.id = :id', { id })
      .getOne();
    if (!parent) throw new NotFoundError(CATALOG_NOT_FOUND);
  }

  private findByLabel<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    label: string,
    parent?: { field: string; id: string },
  ): Promise<T | null> {
    const query = this.db.manager
      .getRepository(entity)
      .createQueryBuilder('n')
      .where('lower(n.label) = :label', { label: label.toLowerCase() });
    if (parent) query.andWhere(`n.${parent.field} = :parentId`, parent);
    return query.setParameter('parentId', parent?.id).getOne();
  }

  /**
   * Alta desde el formulario de una orden: si el nombre ya existe devuelve ese
   * elemento, también cuando dos personas lo crean a la vez.
   */
  private async reuseOrCreate<T extends ObjectLiteral & Node>(
    entity: EntityTarget<T>,
    label: string,
    values: Partial<T>,
    parent?: { field: string; id: string },
  ): Promise<T> {
    const existing = await this.findByLabel(entity, label, parent);
    if (existing) return existing;
    const repository = this.db.manager.getRepository(entity);
    const item = repository.create({
      ...values,
      id: randomUUID(),
      label,
      position: NEW_ITEM_POSITION,
    } as unknown as T);
    try {
      return await repository.save(item);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await this.findByLabel(entity, label, parent);
      if (concurrent) return concurrent;
      throw error;
    }
  }

  async createFamily(label: string) {
    const family = await this.reuseOrCreate(CatalogFamilyEntity, label, {});
    return { id: family.id, label: family.label, products: [] };
  }

  async createProduct(familyId: string, label: string) {
    await this.ensureParent(CatalogFamilyEntity, familyId);
    const product = await this.reuseOrCreate(
      CatalogProductEntity,
      label,
      { familyId },
      { field: 'familyId', id: familyId },
    );
    return { id: product.id, label: product.label, questions: [] };
  }

  async createQuestion(productId: string, label: string) {
    await this.ensureParent(CatalogProductEntity, productId);
    const question = await this.reuseOrCreate(
      CatalogQuestionEntity,
      label,
      { productId },
      { field: 'productId', id: productId },
    );
    return { id: question.id, label: question.label, options: [] };
  }

  async createOption(questionId: string, input: CatalogOptionInput) {
    await this.ensureParent(CatalogQuestionEntity, questionId);
    const option = await this.reuseOrCreate(
      CatalogOptionEntity,
      input.label,
      { questionId, phrase: input.phrase || input.label },
      { field: 'questionId', id: questionId },
    );
    return toOption(option);
  }

  async rename<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: string,
    values: Record<string, string>,
  ): Promise<void> {
    await this.ensureParent(entity, id);
    try {
      await this.db.transaction((manager) =>
        manager.getRepository(entity).update(id, values as never),
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError(DUPLICATE_LABEL);
      throw error;
    }
  }

  async updateOption(id: string, input: CatalogOptionInput): Promise<void> {
    await this.rename(CatalogOptionEntity, id, {
      label: input.label,
      phrase: input.phrase || input.label,
    });
  }

  /** Los hijos quedan intactos: dejan de verse porque su padre ya no aparece. */
  async softDelete<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: string,
    actor: string,
  ): Promise<void> {
    await this.ensureParent(entity, id);
    await this.db.transaction((manager) =>
      manager
        .getRepository(entity)
        .update(id, { deletedAt: new Date(), deletedBy: actor } as never),
    );
  }
}
