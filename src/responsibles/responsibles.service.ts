import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
} from '../common/errors';
import { ResponsibleEntity } from '../database/entities';
import { CurrentUser } from '../domain/current-user';
import { PermissionKey, ScopeType } from '../domain/enums';
import { AREA_NAMES } from '../domain/workflow';
import { ResponsibleCreate } from './responsibles.schemas';

const toResponse = (responsible: ResponsibleEntity) => ({
  id: Number(responsible.id),
  area: responsible.area,
  name: responsible.name,
  email: responsible.email ?? undefined,
  active: responsible.active,
});

function canViewArea(user: CurrentUser, area: string): boolean {
  if (user.isSuperadmin) return true;
  const read = user.grant(PermissionKey.TASKS_READ);
  if (read?.scopeType === ScopeType.ALL) return true;
  if (
    read?.scopeType === ScopeType.ASSIGNED_AREAS &&
    read.areas.includes(area)
  ) {
    return true;
  }
  return canManageArea(user, area);
}

function canManageArea(user: CurrentUser, area: string): boolean {
  if (user.isSuperadmin) return true;
  return [PermissionKey.TASKS_ASSIGN, PermissionKey.ORDERS_ASSIGN].some(
    (key) => user.grant(key)?.targetAreas.includes(area) ?? false,
  );
}

@Injectable()
export class ResponsiblesService {
  constructor(private readonly db: DataSource) {}

  findByAreaAndName(
    manager: EntityManager,
    area: string,
    name: string,
  ): Promise<ResponsibleEntity | null> {
    return manager
      .createQueryBuilder(ResponsibleEntity, 'r')
      .where('r.area = :area AND r.active AND lower(r.name) = :name', {
        area,
        name: name.trim().toLowerCase(),
      })
      .getOne();
  }

  private findByAreaAndEmail(
    manager: EntityManager,
    area: string,
    email: string,
  ): Promise<ResponsibleEntity | null> {
    return manager
      .createQueryBuilder(ResponsibleEntity, 'r')
      .where('r.area = :area AND r.active AND lower(r.email) = :email', {
        area,
        email,
      })
      .getOne();
  }

  async list(user: CurrentUser, area: string) {
    if (!(area in AREA_NAMES) || !canViewArea(user, area)) {
      throw new ForbiddenError('No puedes consultar responsables de esa área.');
    }
    const responsibles = await this.db.manager
      .createQueryBuilder(ResponsibleEntity, 'r')
      .where('r.area = :area AND r.active', { area })
      .orderBy('lower(r.name)')
      .getMany();
    return responsibles.map(toResponse);
  }

  async create(user: CurrentUser, payload: ResponsibleCreate) {
    const { area, name } = payload;
    if (!(area in AREA_NAMES) || !canManageArea(user, area)) {
      throw new ForbiddenError(
        'No puedes administrar responsables de esa área.',
      );
    }
    const email = payload.email ?? null;
    try {
      const responsible = await this.db.transaction(async (manager) => {
        if (await this.findByAreaAndName(manager, area, name)) {
          throw new ConflictError(
            'Ese responsable ya está registrado en el área.',
          );
        }
        if (email && (await this.findByAreaAndEmail(manager, area, email))) {
          throw new ConflictError('Ese correo ya está registrado en el área.');
        }
        return manager.save(
          manager.create(ResponsibleEntity, {
            area,
            name,
            email,
            active: true,
            createdAt: new Date(),
          }),
        );
      });
      return toResponse(responsible);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'Ese responsable ya está registrado en el área.',
        );
      }
      throw error;
    }
  }

  async remove(user: CurrentUser, id: number): Promise<void> {
    await this.db.transaction(async (manager) => {
      const responsible = await manager.findOneBy(ResponsibleEntity, {
        id: String(id),
      });
      if (!responsible?.active) {
        throw new NotFoundError('No se encontró el responsable.');
      }
      if (!canManageArea(user, responsible.area)) {
        throw new ForbiddenError(
          'No puedes administrar responsables de esa área.',
        );
      }
      await manager.update(ResponsibleEntity, responsible.id, {
        active: false,
      });
    });
  }
}
