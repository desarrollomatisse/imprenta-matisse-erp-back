import {
  Body,
  Controller,
  createParamDecorator,
  Delete,
  ExecutionContext,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions, User } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser } from '../domain/current-user';
import { PermissionKey } from '../domain/enums';
import {
  AttachmentRequest,
  attachmentRequestSchema,
  idempotencyKeySchema,
  IncidentCreate,
  incidentCreateSchema,
  NoteCreate,
  noteCreateSchema,
  OrderAssign,
  orderAssignSchema,
  OrderCancel,
  orderCancelSchema,
  OrderCreate,
  orderCreateSchema,
  OrderReactivate,
  orderReactivateSchema,
  OrderUpdate,
  orderUpdateSchema,
  orderVersionSchema,
  Page,
  pageSchema,
} from './orders.schemas';
import { OrdersService } from './orders.service';

const ExpectedVersion = createParamDecorator(
  (_data: unknown, context: ExecutionContext): number => {
    const request = context.switchToHttp().getRequest<Request>();
    return new ZodPipe(orderVersionSchema).transform(
      request.headers['if-match'],
    );
  },
);

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  @RequirePermissions(PermissionKey.ORDERS_READ)
  async list(
    @Query(new ZodPipe(pageSchema)) page: Page,
    @User() user: CurrentUser,
  ) {
    return { data: await this.orders.list(user, page) };
  }

  @Post('orders')
  @RequirePermissions(PermissionKey.ORDERS_CREATE)
  async create(
    @Body(new ZodPipe(orderCreateSchema)) body: OrderCreate,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: CurrentUser,
  ) {
    const key = new ZodPipe(idempotencyKeySchema).transform(idempotencyKey);
    return { data: await this.orders.create(user, body, key) };
  }

  @Get('orders/:identifier')
  @RequirePermissions(PermissionKey.ORDERS_READ)
  async detail(
    @Param('identifier') identifier: string,
    @User() user: CurrentUser,
  ) {
    return { data: await this.orders.detail(user, identifier) };
  }

  @Patch('orders/:identifier')
  @RequirePermissions(PermissionKey.ORDERS_EDIT)
  async update(
    @Param('identifier') identifier: string,
    @Body(new ZodPipe(orderUpdateSchema)) body: OrderUpdate,
    @ExpectedVersion() version: number,
    @User() user: CurrentUser,
  ) {
    return { data: await this.orders.update(user, identifier, body, version) };
  }

  @Post('orders/:identifier/cancel')
  @HttpCode(200)
  @RequirePermissions(PermissionKey.ORDERS_CANCEL)
  async cancel(
    @Param('identifier') identifier: string,
    @Body(new ZodPipe(orderCancelSchema)) body: OrderCancel,
    @ExpectedVersion() version: number,
    @User() user: CurrentUser,
  ) {
    return { data: await this.orders.cancel(user, identifier, body, version) };
  }

  @Post('orders/:identifier/reactivate')
  @HttpCode(200)
  @RequirePermissions(PermissionKey.ORDERS_REACTIVATE)
  async reactivate(
    @Param('identifier') identifier: string,
    @Body(new ZodPipe(orderReactivateSchema)) body: OrderReactivate,
    @ExpectedVersion() version: number,
    @User() user: CurrentUser,
  ) {
    return {
      data: await this.orders.reactivate(user, identifier, body, version),
    };
  }

  @Delete('orders/:identifier')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.ORDERS_DELETE)
  async remove(
    @Param('identifier') identifier: string,
    @ExpectedVersion() version: number,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.orders.remove(user, identifier, version);
  }

  @Delete('orders/:identifier/attachments/:fileId')
  @RequirePermissions(
    PermissionKey.ORDERS_CREATE,
    PermissionKey.ORDERS_EDIT,
    PermissionKey.ORDERS_ASSIGN,
    PermissionKey.TASKS_ASSIGN,
  )
  async removeAttachment(
    @Param('identifier') identifier: string,
    @Param('fileId') fileId: string,
    @User() user: CurrentUser,
  ) {
    return {
      data: await this.orders.removeAttachment(user, identifier, fileId),
    };
  }

  @Post('orders/:identifier/assign')
  @HttpCode(200)
  @RequirePermissions(PermissionKey.ORDERS_ASSIGN, PermissionKey.TASKS_ASSIGN)
  async assign(
    @Param('identifier') identifier: string,
    @Body(new ZodPipe(orderAssignSchema)) body: OrderAssign,
    @ExpectedVersion() version: number,
    @User() user: CurrentUser,
  ) {
    return { data: await this.orders.assign(user, identifier, body, version) };
  }

  @Post('orders/:identifier/notes')
  @RequirePermissions(PermissionKey.ORDERS_NOTE_CREATE)
  async addNote(
    @Param('identifier') identifier: string,
    @Body(new ZodPipe(noteCreateSchema)) body: NoteCreate,
    @User() user: CurrentUser,
  ) {
    return { data: await this.orders.addNote(user, identifier, body) };
  }

  @Post('orders/:identifier/attachments')
  @RequirePermissions(
    PermissionKey.ORDERS_CREATE,
    PermissionKey.ORDERS_EDIT,
    PermissionKey.ORDERS_ASSIGN,
    PermissionKey.TASKS_ASSIGN,
  )
  async attachFiles(
    @Param('identifier') identifier: string,
    @Body(new ZodPipe(attachmentRequestSchema)) body: AttachmentRequest,
    @User() user: CurrentUser,
  ) {
    return {
      data: await this.orders.attachFiles(user, identifier, body.attachments),
    };
  }

  @Post('orders/:identifier/incidents')
  @RequirePermissions(PermissionKey.TASKS_INCIDENT_REPORT)
  async reportIncident(
    @Param('identifier') identifier: string,
    @Body(new ZodPipe(incidentCreateSchema)) body: IncidentCreate,
    @ExpectedVersion() version: number,
    @User() user: CurrentUser,
  ) {
    return {
      data: await this.orders.reportIncident(user, identifier, body, version),
    };
  }

  @Post('orders/:identifier/approve')
  @HttpCode(200)
  @RequirePermissions(PermissionKey.ORDERS_APPROVE)
  async approve(
    @Param('identifier') identifier: string,
    @ExpectedVersion() version: number,
    @User() user: CurrentUser,
  ) {
    return { data: await this.orders.approve(user, identifier, version) };
  }
}
