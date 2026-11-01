import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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

  @Post()
  async create(
    @Body(new ZodPipe(responsibleCreateSchema)) body: ResponsibleCreate,
    @User() user: CurrentUser,
  ) {
    return { data: await this.responsibles.create(user, body) };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', new ZodPipe(responsibleIdSchema)) id: number,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.responsibles.remove(user, id);
  }
}
