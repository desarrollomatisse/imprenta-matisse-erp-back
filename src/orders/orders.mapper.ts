import { env } from '../config/env';
import {
  OrderAttachmentEntity,
  OrderEntity,
  OrderEventEntity,
} from '../database/entities';
import { CurrentUser } from '../domain/current-user';
import { OrderStatus, PermissionKey } from '../domain/enums';
import {
  areaName,
  HANDOFF_DESTINATIONS,
  roleArea,
  trackingStage,
} from '../domain/workflow';
import { canAssignArea } from './orders.scope';

const BUSINESS_TIME_ZONE = 'America/Lima';

/**
 * URL propia de la API para abrir un adjunto. El front nunca recibe una URL de
 * Google Drive: el backend entrega el archivo tras validar la sesión.
 */
export const attachmentDownloadUrl = (fileId: string) =>
  `${env.API_PUBLIC_URL}/archivos/${encodeURIComponent(fileId)}/descargar`;

const businessDate = (value: Date) =>
  value.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });

function attachmentToResponse(attachment: OrderAttachmentEntity) {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    webViewLink: attachmentDownloadUrl(attachment.id),
    createdAt: attachment.createdAt.toISOString(),
  };
}

export function eventToResponse(event: OrderEventEntity) {
  return {
    id: event.id,
    text: event.text,
    at: event.createdAt.toISOString(),
    by: event.actor,
    status: event.status ?? undefined,
    targetArea: event.targetArea ?? undefined,
    fromRole: event.fromRole ?? undefined,
    targetRole: event.targetRole ?? undefined,
    assignment:
      event.assignmentAssignee && event.assignmentArea
        ? { assignee: event.assignmentAssignee, area: event.assignmentArea }
        : undefined,
    attachments: event.attachments.map(attachmentToResponse),
  };
}

function destinationsFor(order: OrderEntity, user: CurrentUser) {
  if (
    order.summaryStatus === OrderStatus.READY ||
    order.summaryStatus === OrderStatus.CANCELLED
  ) {
    return [];
  }
  const ownArea = roleArea(user.roleKey);
  return HANDOFF_DESTINATIONS.filter(
    ({ area }) => area !== ownArea && canAssignArea(user, area),
  ).map(({ status, area }) => ({ status, area, label: areaName(area) }));
}

export function orderToResponse(order: OrderEntity, user: CurrentUser) {
  const canRead = (permission: PermissionKey, value: string | null) =>
    user.can(permission) ? (value ?? undefined) : undefined;
  return {
    id: order.id,
    number: order.number,
    version: order.version,
    customer: {
      name: canRead(
        PermissionKey.ORDERS_CUSTOMER_NAME_READ,
        order.customerName,
      ),
      phone: canRead(
        PermissionKey.ORDERS_CUSTOMER_PHONE_READ,
        order.customerPhone,
      ),
      deliveryAddress: canRead(
        PermissionKey.ORDERS_DELIVERY_ADDRESS_READ,
        order.customerAddress,
      ),
    },
    product: {
      family: order.productFamily,
      name: order.productName,
      specifications: order.specifications,
    },
    quantity: order.quantity,
    dueDate: order.dueDate,
    summaryStatus: order.summaryStatus,
    trackingStage: trackingStage(order.summaryStatus),
    currentArea: order.currentArea ?? undefined,
    destinations: destinationsFor(order, user),
    hasPlate: order.hasPlate,
    createdAt: businessDate(order.createdAt),
    events: order.events.map(eventToResponse),
  };
}
