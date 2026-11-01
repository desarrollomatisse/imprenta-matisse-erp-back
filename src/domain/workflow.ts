import { Area, OrderStatus, TaskStatus } from './enums';

// Áreas y estados son el contrato entre el front y el back; viven en código.
export const INITIAL_STATUS_KEY: string = OrderStatus.DESIGN;
export const INITIAL_AREA_KEY: string = Area.DESIGN;
export const INITIAL_TASK_STATUS_KEY: string = TaskStatus.PENDING;

export const AREA_NAMES: Record<string, string> = {
  [Area.ATTENTION]: 'Atención',
  [Area.DESIGN]: 'Diseño',
  [Area.PRODUCTION]: 'Producción',
  [Area.FINISHING]: 'Acabados',
  [Area.MANAGEMENT]: 'Gerencia',
};

export const ALL_AREA_KEYS = Object.keys(AREA_NAMES);

const ORDER_STATUS_AREAS: Record<string, string> = {
  [OrderStatus.RECEIVED]: Area.ATTENTION,
  [OrderStatus.DESIGN]: Area.DESIGN,
  [OrderStatus.CUSTOMER_REVIEW]: Area.ATTENTION,
  [OrderStatus.PRODUCTION]: Area.PRODUCTION,
  [OrderStatus.FINISHING]: Area.FINISHING,
  [OrderStatus.APPROVAL]: Area.MANAGEMENT,
  [OrderStatus.READY]: Area.MANAGEMENT,
  [OrderStatus.INCIDENT]: Area.PRODUCTION,
};

const ASSIGNABLE_ORDER_STATUSES: readonly string[] = [
  OrderStatus.RECEIVED,
  OrderStatus.DESIGN,
  OrderStatus.CUSTOMER_REVIEW,
  OrderStatus.PRODUCTION,
  OrderStatus.FINISHING,
  OrderStatus.APPROVAL,
  OrderStatus.INCIDENT,
];

const TASK_STATUS_NAMES: Record<string, string> = {
  [TaskStatus.PENDING]: 'Pendiente',
  [TaskStatus.ASSIGNED]: 'Asignada',
  [TaskStatus.IN_PROGRESS]: 'En curso',
  [TaskStatus.BLOCKED]: 'Bloqueada',
  [TaskStatus.COMPLETED]: 'Completada',
  [TaskStatus.CANCELLED]: 'Cancelada',
};

const TERMINAL_TASK_STATUSES: readonly string[] = [
  TaskStatus.COMPLETED,
  TaskStatus.CANCELLED,
];

export const ACTIVE_TASK_STATUSES = Object.keys(TASK_STATUS_NAMES).filter(
  (status) => !TERMINAL_TASK_STATUSES.includes(status),
);

// Destinos a los que se puede enviar una orden. El detalle de cada orden expone
// los que el rol puede usar, para que el front no repita este cruce.
export const HANDOFF_DESTINATIONS = [
  { status: OrderStatus.RECEIVED, area: Area.ATTENTION },
  { status: OrderStatus.DESIGN, area: Area.DESIGN },
  { status: OrderStatus.PRODUCTION, area: Area.PRODUCTION },
  { status: OrderStatus.FINISHING, area: Area.FINISHING },
  { status: OrderStatus.APPROVAL, area: Area.MANAGEMENT },
];

// Etapa visible para el cliente: resume el estado sin revelar el detalle.
const TRACKING_STAGE_BY_STATUS: Record<string, string> = {
  [OrderStatus.RECEIVED]: 'registering',
  [OrderStatus.DESIGN]: 'registering',
  [OrderStatus.CUSTOMER_REVIEW]: 'registering',
  [OrderStatus.PRODUCTION]: 'inProgress',
  [OrderStatus.FINISHING]: 'inProgress',
  [OrderStatus.APPROVAL]: 'inProgress',
  [OrderStatus.INCIDENT]: 'inProgress',
  [OrderStatus.READY]: 'ready',
  [OrderStatus.CANCELLED]: 'cancelled',
};

export const trackingStage = (status: string) =>
  TRACKING_STAGE_BY_STATUS[status] ?? 'registering';

export const areaName = (area: string) => AREA_NAMES[area] ?? area;

export const isAssignableOrderStatus = (status: string) =>
  ASSIGNABLE_ORDER_STATUSES.includes(status);

export const orderStatusArea = (status: string): string | null =>
  ORDER_STATUS_AREAS[status] ?? null;

export const isActiveTaskStatus = (status: string) =>
  ACTIVE_TASK_STATUSES.includes(status);
