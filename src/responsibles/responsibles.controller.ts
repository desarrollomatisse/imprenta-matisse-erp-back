import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { User } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser } from '../domain/current-user';
import {
  ResponsibleCreate,
  responsibleCreateSchema,
  responsibleIdSchema,
  ResponsibleQuery,
  responsibleQuerySchema,
  ResponsibleStatus,
  responsibleStatusSchema,
} from './responsibles.schemas';
import { ResponsiblesService } from './responsibles.service';

@Controller('responsibles')
export class ResponsiblesController {
  constructor(private readonly responsibles: ResponsiblesService) {}

  @Get()
  async list(
    @Query(new ZodPipe(responsibleQuerySchema)) query: ResponsibleQuery,
    @User() user: CurrentUser,
  ) {
    return { data: await this.responsibles.list(user, query.area) };
  }

  @Get('all')
  async listAll(@User() user: CurrentUser) {
    return { data: await this.responsibles.listAll(user) };
  }

  @Post()
  async create(
    @Body(new ZodPipe(responsibleCreateSchema)) body: ResponsibleCreate,
    @User() user: CurrentUser,
  ) {
    return { data: await this.responsibles.create(user, body) };
  }

  @Patch(':id')
  async setStatus(
    @Param('id', new ZodPipe(responsibleIdSchema)) id: number,
    @Body(new ZodPipe(responsibleStatusSchema)) body: ResponsibleStatus,
    @User() user: CurrentUser,
  ) {
    return { data: await this.responsibles.setActive(user, id, body.active) };
  }
}
