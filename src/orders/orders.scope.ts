import { SelectQueryBuilder } from 'typeorm';
import { ForbiddenError, NotFoundError } from '../common/errors';
import {
  OrderEntity,
  OrderTaskEntity,
  ResponsibleEntity,
} from '../database/entities';
import { CurrentUser } from '../domain/current-user';
import { OrderStatus, PermissionKey, ScopeType } from '../domain/enums';
import { ACTIVE_TASK_STATUSES, isActiveTaskStatus } from '../domain/workflow';

const ATTACH_PERMISSIONS: readonly PermissionKey[] = [
  PermissionKey.ORDERS_CREATE,
  PermissionKey.ORDERS_EDIT,
  PermissionKey.ORDERS_ASSIGN,
  PermissionKey.TASKS_ASSIGN,
];

const isResponsible = (
  responsible: ResponsibleEntity | null | undefined,
  user: CurrentUser,
) => responsible?.email?.toLowerCase() === user.email.toLowerCase();

export function latestActiveTask(
  order: OrderEntity,
): OrderTaskEntity | undefined {
  return order.tasks.findLast((task) => isActiveTaskStatus(task.status));
}

function orderInScope(user: CurrentUser, order: OrderEntity): boolean {
  if (user.isSuperadmin) return true;
  const grant = user.grant(PermissionKey.ORDERS_READ);
  if (!grant) return false;
  // Una cancelada no tiene área: quien la reactiva necesita poder verla.
  if (
    order.summaryStatus === OrderStatus.CANCELLED &&
    user.can(PermissionKey.ORDERS_REACTIVATE)
  ) {
    return true;
  }
  const task = latestActiveTask(order);
  switch (grant.scopeType) {
    case ScopeType.ALL:
      return true;
    case ScopeType.ASSIGNED_AREAS: {
      const area = order.currentArea ?? task?.area;
      return area !== undefined && grant.areas.includes(area);
    }
    case ScopeType.ASSIGNED_TO_ME:
      return isResponsible(task?.responsible, user);
    default:
      return false;
  }
}

/** Una orden fuera de alcance responde igual que una inexistente. */
export function ensureOrderScope(user: CurrentUser, order: OrderEntity): void {
  if (!orderInScope(user, order)) {
    throw new NotFoundError('No se encontró la orden.');
  }
}

export function ensureTaskScope(
  user: CurrentUser,
  permission: PermissionKey,
  task: OrderTaskEntity,
): void {
  if (!taskInScope(user, permission, task)) {
    throw new ForbiddenError('La tarea está fuera del alcance de tu rol.');
  }
}

function taskInScope(
  user: CurrentUser,
  permission: PermissionKey,
  task: OrderTaskEntity,
): boolean {
  if (user.isSuperadmin) return true;
  const grant = user.grant(permission);
  if (!grant) return false;
  const scope = grant.scopeType ? grant : user.grant(PermissionKey.TASKS_READ);
  switch (scope?.scopeType) {
    case ScopeType.ALL:
      return true;
    case ScopeType.ASSIGNED_AREAS:
      return scope.areas.includes(task.area);
    case ScopeType.ASSIGNED_TO_ME:
      return isResponsible(task.responsible, user);
    default:
      return false;
  }
}

export function canAssignArea(user: CurrentUser, area: string): boolean {
  if (user.isSuperadmin) return true;
  return [PermissionKey.ORDERS_ASSIGN, PermissionKey.TASKS_ASSIGN].some(
    (key) => user.grant(key)?.targetAreas.includes(area) ?? false,
  );
}

export function ensureCanAttach(user: CurrentUser): void {
  if (!ATTACH_PERMISSIONS.some((key) => user.can(key))) {
    throw new ForbiddenError(
      'No tienes permiso para adjuntar archivos a órdenes.',
    );
  }
}

const NOTHING = '1 = 0';

export function applyOrderScope(
  query: SelectQueryBuilder<OrderEntity>,
  user: CurrentUser,
): SelectQueryBuilder<OrderEntity> {
  if (user.isSuperadmin) return query;
  const grant = user.grant(PermissionKey.ORDERS_READ);
  const reactivable = user.can(PermissionKey.ORDERS_REACTIVATE)
    ? `OR o.summaryStatus = '${OrderStatus.CANCELLED}'`
    : '';
  switch (grant?.scopeType) {
    case ScopeType.ALL:
      return query;
    case ScopeType.ASSIGNED_AREAS:
      return query.andWhere(
        `(o.currentArea IN (:...scopeAreas) ${reactivable})`,
        { scopeAreas: grant.areas },
      );
    case ScopeType.ASSIGNED_TO_ME:
      return query.andWhere(
        `(EXISTS (
          SELECT 1 FROM order_tasks t
          JOIN responsibles r ON r.id = t.responsible_id
          WHERE t.order_id = o.id
            AND t.status IN (:...activeStatuses)
            AND lower(r.email) = :scopeEmail
        ) ${reactivable})`,
        {
          activeStatuses: ACTIVE_TASK_STATUSES,
          scopeEmail: user.email.toLowerCase(),
        },
      );
    default:
      return query.andWhere(NOTHING);
  }
}
