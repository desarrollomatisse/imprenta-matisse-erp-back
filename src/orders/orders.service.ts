import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '../common/errors';
import {
  OrderAttachmentEntity,
  OrderEntity,
  OrderEventEntity,
  OrderTaskEntity,
} from '../database/entities';
import { MAX_ORDER_NUMBER_ATTEMPTS } from '../domain/constants';
import { CurrentUser } from '../domain/current-user';
import { Area, OrderStatus, PermissionKey, TaskStatus } from '../domain/enums';
import {
  generateEventId,
  generateOrderIdentity,
  generateTaskId,
} from '../domain/identifiers';
import {
  areaName,
  INITIAL_AREA_KEY,
  INITIAL_STATUS_KEY,
  INITIAL_TASK_STATUS_KEY,
  isActiveTaskStatus,
  isAssignableOrderStatus,
  orderStatusArea,
  roleArea,
  trackingStage,
} from '../domain/workflow';
import { ResponsiblesService } from '../responsibles/responsibles.service';
import { eventToResponse, orderToResponse } from './orders.mapper';
import {
  AttachmentInput,
  IncidentCreate,
  NoteCreate,
  OrderAssign,
  OrderCancel,
  OrderCreate,
  OrderReactivate,
  OrderUpdate,
  Page,
} from './orders.schemas';
import {
  applyOrderScope,
  canAssignArea,
  ensureCanAttach,
  ensureOrderScope,
  ensureTaskScope,
  latestActiveTask,
} from './orders.scope';

type NewEvent = Partial<OrderEventEntity> & { text: string };

// Primero lo que vence antes; lo listo y lo cancelado ya no apura a nadie.
const CLOSED_ORDER_LAST = `CASE WHEN o.summary_status IN ('${OrderStatus.READY}', '${OrderStatus.CANCELLED}') THEN 1 ELSE 0 END`;

const STALE_ORDER =
  'Otra persona cambió esta orden hace un momento y tu acción no se aplicó. Revisa cómo quedó.';

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DataSource,
    private readonly responsibles: ResponsiblesService,
  ) {}

  // --- Consultas ------------------------------------------------------------

  private async hydrate(
    manager: EntityManager,
    orders: OrderEntity[],
  ): Promise<OrderEntity[]> {
    const ids = orders.map((order) => order.id);
    const tasks = await manager.find(OrderTaskEntity, {
      where: { orderId: In(ids) },
      relations: { responsible: true },
      order: { createdAt: 'ASC' },
    });
    const events = await manager.find(OrderEventEntity, {
      where: { orderId: In(ids) },
      order: { createdAt: 'DESC' },
    });
    const attachments = await manager.find(OrderAttachmentEntity, {
      where: { orderId: In(ids) },
      order: { createdAt: 'ASC' },
    });
    const linked = attachments.filter((attachment) => attachment.eventId);
    const attachmentsByEvent = groupBy(linked, (item) => item.eventId ?? '');
    for (const event of events) {
      event.attachments = attachmentsByEvent.get(event.id) ?? [];
    }
    const tasksByOrder = groupBy(tasks, (task) => task.orderId);
    const eventsByOrder = groupBy(events, (event) => event.orderId);
    for (const order of orders) {
      order.tasks = tasksByOrder.get(order.id) ?? [];
      order.events = eventsByOrder.get(order.id) ?? [];
    }
    return orders;
  }

  /** Acepta el id interno o el número de orden. */
  async findOrder(
    identifier: string,
    manager: EntityManager = this.db.manager,
    forUpdate = false,
  ): Promise<OrderEntity | null> {
    const query = manager
      .createQueryBuilder(OrderEntity, 'o')
      .where('o.id = :identifier OR o.number = :identifier', { identifier });
    if (forUpdate) query.setLock('pessimistic_write');
    const order = await query.getOne();
    if (!order) return null;
    await this.hydrate(manager, [order]);
    return order;
  }

  private async getOrder(
    identifier: string,
    manager?: EntityManager,
    forUpdate = false,
  ): Promise<OrderEntity> {
    const order = await this.findOrder(identifier, manager, forUpdate);
    if (!order) throw new NotFoundError('No se encontró la orden.');
    return order;
  }

  async list(user: CurrentUser, page: Page) {
    const manager = this.db.manager;
    const query = manager
      .createQueryBuilder(OrderEntity, 'o')
      .addSelect(CLOSED_ORDER_LAST, 'closed_last')
      .orderBy('closed_last', 'ASC')
      .addOrderBy('o.dueDate', 'ASC')
      .addOrderBy('o.createdAt', 'ASC')
      .addOrderBy('o.number', 'ASC')
      .limit(page.limit)
      .offset(page.offset);
    const orders = await applyOrderScope(query, user).getMany();
    if (orders.length > 0) await this.hydrate(manager, orders);
    return orders.map((order) => orderToResponse(order, user));
  }

  async detail(user: CurrentUser, identifier: string) {
    const order = await this.getOrder(identifier);
    ensureOrderScope(user, order);
    return orderToResponse(order, user);
  }

  /** Consulta pública: solo por número y sin datos del cliente. */
  async publicTracking(code: string) {
    const order = await this.db.manager.findOneBy(OrderEntity, {
      number: code.trim().toUpperCase(),
    });
    if (!order) throw new NotFoundError('No se encontró el pedido.');
    return {
      number: order.number,
      product: order.productName,
      dueDate: order.dueDate,
      stage: trackingStage(order.summaryStatus),
    };
  }

  // --- Construcción ---------------------------------------------------------

  private async addEvent(
    manager: EntityManager,
    order: OrderEntity,
    user: CurrentUser,
    event: NewEvent,
  ): Promise<string> {
    const id = generateEventId();
    await manager.insert(OrderEventEntity, {
      createdAt: new Date(),
      ...event,
      id,
      orderId: order.id,
      actor: user.email,
      fromRole: user.roleKey,
    });
    return id;
  }

  private async addTask(
    manager: EntityManager,
    order: OrderEntity,
    task: { area: string; responsibleId: string | null; now: Date },
  ): Promise<void> {
    await manager.insert(OrderTaskEntity, {
      id: generateTaskId(),
      orderId: order.id,
      area: task.area,
      status: INITIAL_TASK_STATUS_KEY,
      responsibleId: task.responsibleId,
      plannedQuantity: order.quantity,
      completedQuantity: 0,
      createdAt: task.now,
      updatedAt: task.now,
    });
  }

  private async closeActiveTasks(
    manager: EntityManager,
    order: OrderEntity,
    now: Date,
  ): Promise<void> {
    const active = order.tasks.filter((task) =>
      isActiveTaskStatus(task.status),
    );
    if (active.length === 0) return;
    await manager.update(
      OrderTaskEntity,
      { id: In(active.map((task) => task.id)) },
      { status: TaskStatus.COMPLETED, updatedAt: now },
    );
  }

  /** Cada tarea recuerda su estado para retomarse si se reactiva la orden. */
  private async suspendActiveTasks(
    manager: EntityManager,
    order: OrderEntity,
    now: Date,
  ): Promise<void> {
    const active = order.tasks.filter((task) =>
      isActiveTaskStatus(task.status),
    );
    if (active.length === 0) return;
    await manager.update(
      OrderTaskEntity,
      { id: In(active.map((task) => task.id)) },
      {
        cancelledFromStatus: () => 'status',
        status: TaskStatus.CANCELLED,
        updatedAt: now,
      },
    );
  }

  private async resumeSuspendedTasks(
    manager: EntityManager,
    order: OrderEntity,
    now: Date,
  ): Promise<void> {
    await manager.update(
      OrderTaskEntity,
      { orderId: order.id, cancelledFromStatus: Not(IsNull()) },
      {
        status: () => 'cancelled_from_status',
        cancelledFromStatus: null,
        updatedAt: now,
      },
    );
  }

  private activeTask(
    order: OrderEntity,
    user: CurrentUser,
    permission: PermissionKey,
  ): OrderTaskEntity {
    const task = latestActiveTask(order);
    if (!task) throw new ConflictError('La orden no tiene una tarea activa.');
    ensureTaskScope(user, permission, task);
    return task;
  }

  private async resolveAttachments(
    manager: EntityManager,
    order: OrderEntity,
    payload: AttachmentInput[],
  ): Promise<OrderAttachmentEntity[]> {
    const ids = payload.map((attachment) => attachment.id);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError(
        'No se puede repetir un adjunto en la misma operación.',
      );
    }
    const found = await manager.findBy(OrderAttachmentEntity, { id: In(ids) });
    const byId = new Map(
      found.map((attachment) => [attachment.id, attachment]),
    );
    return ids.map((id) => {
      const attachment = byId.get(id);
      if (!attachment) {
        throw new ValidationError(
          'El archivo no pertenece a una subida válida de esta orden.',
        );
      }
      if (attachment.orderId !== order.id) {
        throw new ValidationError('El archivo pertenece a otra orden.');
      }
      if (attachment.eventId !== null) {
        throw new ValidationError(
          'El archivo ya está vinculado a otro evento.',
        );
      }
      return attachment;
    });
  }

  private async linkAttachments(
    manager: EntityManager,
    eventId: string,
    attachments: OrderAttachmentEntity[],
  ): Promise<void> {
    if (attachments.length === 0) return;
    await manager.update(
      OrderAttachmentEntity,
      { id: In(attachments.map((attachment) => attachment.id)) },
      { eventId },
    );
  }

  /**
   * Bloquea la orden, valida el alcance y persiste los cambios de `work`. La
   * transacción es todo o nada: si algo falla, no queda ningún cambio a medias.
   * Con `expectedVersion`, de dos acciones simultáneas solo pasa la primera en
   * tomar el bloqueo: la otra espera, ve la versión nueva y no aplica nada.
   */
  private async withOrder<T>(
    user: CurrentUser,
    identifier: string,
    work: (manager: EntityManager, order: OrderEntity) => Promise<T>,
    expectedVersion?: number,
  ): Promise<{ order: OrderEntity; result: T }> {
    const { order, result } = await this.db.transaction(async (manager) => {
      const locked = await this.getOrder(identifier, manager, true);
      ensureOrderScope(user, locked);
      if (expectedVersion !== undefined && locked.version !== expectedVersion) {
        throw new ConflictError(STALE_ORDER);
      }
      const value = await work(manager, locked);
      if (expectedVersion !== undefined) {
        await manager.increment(OrderEntity, { id: locked.id }, 'version', 1);
      }
      return { order: locked, result: value };
    });
    return { order: await this.getOrder(order.id), result };
  }

  private async updateAndRespond(
    user: CurrentUser,
    identifier: string,
    work: (manager: EntityManager, order: OrderEntity) => Promise<void>,
    expectedVersion?: number,
  ) {
    const { order } = await this.withOrder(
      user,
      identifier,
      work,
      expectedVersion,
    );
    return orderToResponse(order, user);
  }

  // --- Operaciones ----------------------------------------------------------

  /** Devuelve la orden ya creada con esta clave por el mismo usuario. */
  private async findReplay(idempotencyKey: string, user: CurrentUser) {
    const existing = await this.db.manager.findOneBy(OrderEntity, {
      idempotencyKey,
    });
    if (!existing) return null;
    return orderToResponse(await this.getOrder(existing.id), user);
  }

  async create(user: CurrentUser, payload: OrderCreate, key: string) {
    const idempotencyKey = `${user.email}:${key}`;
    const replay = await this.findReplay(idempotencyKey, user);
    if (replay) return replay;

    for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      const { id, number } = generateOrderIdentity();
      try {
        await this.db.transaction(async (manager) => {
          const responsible = await this.responsibles.findByAreaAndName(
            manager,
            INITIAL_AREA_KEY,
            payload.initialAssignee,
          );
          if (!responsible) {
            throw new ValidationError(
              'Selecciona un responsable del área inicial registrado en el sistema.',
            );
          }
          const now = new Date();
          const order = manager.create(OrderEntity, {
            id,
            number,
            customerName: payload.customer.name,
            customerPhone: payload.customer.phone ?? null,
            customerAddress: payload.customer.deliveryAddress ?? null,
            productFamily: payload.product.family,
            productName: payload.product.name,
            specifications: payload.product.specifications,
            quantity: payload.quantity,
            dueDate: payload.dueDate,
            hasPlate: payload.hasPlate,
            summaryStatus: INITIAL_STATUS_KEY,
            currentArea: INITIAL_AREA_KEY,
            createdAt: now,
            updatedAt: now,
            idempotencyKey,
          });
          await manager.insert(OrderEntity, order);
          await this.addTask(manager, order, {
            area: INITIAL_AREA_KEY,
            responsibleId: responsible.id,
            now,
          });
          await this.addEvent(manager, order, user, {
            text: `Orden registrada y enviada a ${areaName(INITIAL_AREA_KEY)} — responsable: ${responsible.name}`,
            status: INITIAL_STATUS_KEY,
            targetArea: INITIAL_AREA_KEY,
            assignmentAssignee: responsible.name,
            assignmentArea: INITIAL_AREA_KEY,
            createdAt: now,
          });
        });
        return orderToResponse(await this.getOrder(id), user);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Otra petición con la misma clave pudo ganar la carrera.
        const concurrent = await this.findReplay(idempotencyKey, user);
        if (concurrent) return concurrent;
      }
    }
    throw new ConflictError('No se pudo generar un número de orden único.');
  }

  /** Sale del flujo y de las áreas, pero sigue visible para quien ve todas. */
  cancel(
    user: CurrentUser,
    identifier: string,
    payload: OrderCancel,
    expectedVersion: number,
  ) {
    return this.updateAndRespond(
      user,
      identifier,
      async (manager, order) => {
        if (order.summaryStatus === OrderStatus.CANCELLED) {
          throw new ConflictError('La orden ya está cancelada.');
        }
        const now = new Date();
        await this.suspendActiveTasks(manager, order, now);
        await manager.update(OrderEntity, order.id, {
          summaryStatus: OrderStatus.CANCELLED,
          currentArea: null,
          cancelledFromStatus: order.summaryStatus,
          cancelledFromArea: order.currentArea,
          updatedAt: now,
        });
        await this.addEvent(manager, order, user, {
          text: `Orden cancelada: ${payload.reason}`,
          status: OrderStatus.CANCELLED,
          createdAt: now,
        });
      },
      expectedVersion,
    );
  }

  /** Vuelve al mismo estado, área, tareas y responsable que tenía al cancelarse. */
  reactivate(
    user: CurrentUser,
    identifier: string,
    payload: OrderReactivate,
    expectedVersion: number,
  ) {
    return this.updateAndRespond(
      user,
      identifier,
      async (manager, order) => {
        if (
          order.summaryStatus !== OrderStatus.CANCELLED ||
          !order.cancelledFromStatus
        ) {
          throw new ConflictError('La orden no está cancelada.');
        }
        const status = order.cancelledFromStatus;
        const area = order.cancelledFromArea;
        const now = new Date();
        await this.resumeSuspendedTasks(manager, order, now);
        await manager.update(OrderEntity, order.id, {
          summaryStatus: status,
          currentArea: area,
          cancelledFromStatus: null,
          cancelledFromArea: null,
          updatedAt: now,
        });
        const destination = area ? ` — vuelve a ${areaName(area)}` : '';
        await this.addEvent(manager, order, user, {
          text: `Orden reactivada: ${payload.reason}${destination}`,
          status,
          targetArea: area,
          createdAt: now,
        });
      },
      expectedVersion,
    );
  }

  /** La orden, su historial y sus archivos quedan guardados. */
  async remove(
    user: CurrentUser,
    identifier: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.db.transaction(async (manager) => {
      const order = await this.getOrder(identifier, manager, true);
      ensureOrderScope(user, order);
      if (order.version !== expectedVersion) {
        throw new ConflictError(STALE_ORDER);
      }
      await this.addEvent(manager, order, user, { text: 'Orden eliminada' });
      await manager.update(OrderEntity, order.id, {
        deletedAt: new Date(),
        deletedBy: user.email,
      });
    });
  }

  /** El archivo sigue en Drive; solo deja de ofrecerse y de poder abrirse. */
  async removeAttachment(
    user: CurrentUser,
    identifier: string,
    fileId: string,
  ) {
    ensureCanAttach(user);
    return this.updateAndRespond(user, identifier, async (manager, order) => {
      const attachment = await manager.findOneBy(OrderAttachmentEntity, {
        id: fileId,
        orderId: order.id,
      });
      if (!attachment) {
        throw new NotFoundError('No se encontró el archivo solicitado.');
      }
      await manager.update(OrderAttachmentEntity, attachment.id, {
        deletedAt: new Date(),
        deletedBy: user.email,
      });
      await manager.update(OrderEntity, order.id, { updatedAt: new Date() });
      await this.addEvent(manager, order, user, {
        text: `Adjunto eliminado: ${attachment.name}`,
      });
    });
  }

  update(
    user: CurrentUser,
    identifier: string,
    payload: OrderUpdate,
    expectedVersion: number,
  ) {
    return this.updateAndRespond(
      user,
      identifier,
      async (manager, order) => {
        if (order.summaryStatus === OrderStatus.CANCELLED) {
          throw new ConflictError('La orden está cancelada.');
        }
        await manager.update(OrderEntity, order.id, {
          dueDate: payload.dueDate ?? order.dueDate,
          hasPlate: payload.hasPlate ?? order.hasPlate,
          specifications: payload.details ?? order.specifications,
          updatedAt: new Date(),
        });
        await this.addEvent(manager, order, user, {
          text: 'Datos de la orden actualizados',
        });
      },
      expectedVersion,
    );
  }

  assign(
    user: CurrentUser,
    identifier: string,
    payload: OrderAssign,
    expectedVersion: number,
  ) {
    if (!isAssignableOrderStatus(payload.status)) {
      throw new ValidationError('El estado no admite asignación.');
    }
    const area = orderStatusArea(payload.status);
    if (area === null) {
      throw new ValidationError(
        'El estado no tiene un área de destino asignada.',
      );
    }
    if (area !== payload.area) {
      throw new ValidationError('El estado no corresponde al área de destino.');
    }
    if (!canAssignArea(user, area)) {
      throw new ForbiddenError('No puedes asignar órdenes a esa área.');
    }
    if (area === roleArea(user.roleKey)) {
      throw new ForbiddenError('No puedes enviar una orden a tu propia área.');
    }
    return this.updateAndRespond(
      user,
      identifier,
      async (manager, order) => {
        if (order.summaryStatus === OrderStatus.READY) {
          throw new ConflictError('La orden ya está lista para entregar.');
        }
        if (order.summaryStatus === OrderStatus.CANCELLED) {
          throw new ConflictError('La orden está cancelada.');
        }
        const responsible = await this.responsibles.findByAreaAndName(
          manager,
          area,
          payload.assignee,
        );
        if (!responsible) {
          throw new ValidationError(
            'Selecciona un responsable activo del área de destino.',
          );
        }
        const attachments = await this.resolveAttachments(
          manager,
          order,
          payload.attachments,
        );
        const now = new Date();
        await this.closeActiveTasks(manager, order, now);
        await manager.update(OrderEntity, order.id, {
          summaryStatus: payload.status,
          currentArea: area,
          updatedAt: now,
        });
        await this.addTask(manager, order, {
          area,
          responsibleId: responsible.id,
          now,
        });
        const incident = (payload.incidentDescription ?? '').trim();
        const prefix = incident ? `Incidencia reportada: ${incident}. ` : '';
        const eventId = await this.addEvent(manager, order, user, {
          text: `${prefix}Orden enviada al área ${areaName(area)} — responsable: ${responsible.name}`,
          status: payload.status,
          targetArea: area,
          assignmentAssignee: responsible.name,
          assignmentArea: area,
          createdAt: now,
        });
        await this.linkAttachments(manager, eventId, attachments);
      },
      expectedVersion,
    );
  }

  private async eventResponse(order: OrderEntity, eventId: string) {
    const event = order.events.find((item) => item.id === eventId);
    return eventToResponse(event as OrderEventEntity);
  }

  async addNote(user: CurrentUser, identifier: string, payload: NoteCreate) {
    const { order, result } = await this.withOrder(
      user,
      identifier,
      async (manager, locked) => {
        await manager.update(OrderEntity, locked.id, { updatedAt: new Date() });
        return this.addEvent(manager, locked, user, {
          text: `Nota: ${payload.text}`,
        });
      },
    );
    return this.eventResponse(order, result);
  }

  async attachFiles(
    user: CurrentUser,
    identifier: string,
    payload: AttachmentInput[],
  ) {
    ensureCanAttach(user);
    const { order, result } = await this.withOrder(
      user,
      identifier,
      async (manager, locked) => {
        const attachments = await this.resolveAttachments(
          manager,
          locked,
          payload,
        );
        const eventId = await this.addEvent(manager, locked, user, {
          text: `Adjuntos agregados: ${attachments.length}`,
        });
        await this.linkAttachments(manager, eventId, attachments);
        await manager.update(OrderEntity, locked.id, { updatedAt: new Date() });
        return eventId;
      },
    );
    return this.eventResponse(order, result);
  }

  reportIncident(
    user: CurrentUser,
    identifier: string,
    payload: IncidentCreate,
    expectedVersion: number,
  ) {
    return this.updateAndRespond(
      user,
      identifier,
      async (manager, order) => {
        this.activeTask(order, user, PermissionKey.TASKS_INCIDENT_REPORT);
        if (order.summaryStatus === OrderStatus.INCIDENT) {
          throw new ConflictError('La orden ya tiene una incidencia abierta.');
        }
        const area = orderStatusArea(OrderStatus.INCIDENT) ?? Area.PRODUCTION;
        const now = new Date();
        await this.closeActiveTasks(manager, order, now);
        await this.addTask(manager, order, {
          area,
          responsibleId: null,
          now,
        });
        await manager.update(OrderEntity, order.id, {
          summaryStatus: OrderStatus.INCIDENT,
          currentArea: area,
          updatedAt: now,
        });
        await this.addEvent(manager, order, user, {
          text: `Incidencia reportada: ${payload.description}`,
          status: OrderStatus.INCIDENT,
          targetArea: area,
          createdAt: now,
        });
      },
      expectedVersion,
    );
  }

  approve(user: CurrentUser, identifier: string, expectedVersion: number) {
    return this.updateAndRespond(
      user,
      identifier,
      async (manager, order) => {
        if (order.summaryStatus !== OrderStatus.APPROVAL) {
          throw new ConflictError(
            'Solo se puede aprobar una orden en estado Visto bueno.',
          );
        }
        const area = orderStatusArea(OrderStatus.READY);
        const now = new Date();
        await this.closeActiveTasks(manager, order, now);
        await manager.update(OrderEntity, order.id, {
          summaryStatus: OrderStatus.READY,
          currentArea: area,
          updatedAt: now,
        });
        await this.addEvent(manager, order, user, {
          text: 'Orden aprobada y lista para entregar',
          status: OrderStatus.READY,
          targetArea: area,
          createdAt: now,
        });
      },
      expectedVersion,
    );
  }
}
