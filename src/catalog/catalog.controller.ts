import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions, User } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import {
  CatalogFamilyEntity,
  CatalogOptionEntity,
  CatalogProductEntity,
  CatalogQuestionEntity,
} from '../database/entities';
import { CurrentUser } from '../domain/current-user';
import { PermissionKey } from '../domain/enums';
import {
  CatalogNode,
  catalogNodeSchema,
  CatalogOptionInput,
  catalogOptionSchema,
} from './catalog.schemas';
import { CatalogService } from './catalog.service';

/**
 * Quien registra órdenes puede agregar lo que no encuentre sin salir del
 * formulario. Corregir o eliminar lo existente requiere `catalog.manage`.
 */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  async products() {
    return { data: await this.catalog.tree() };
  }

  @Post('families')
  @RequirePermissions(PermissionKey.ORDERS_CREATE)
  async createFamily(@Body(new ZodPipe(catalogNodeSchema)) body: CatalogNode) {
    return { data: await this.catalog.createFamily(body.label) };
  }

  @Post('families/:id/products')
  @RequirePermissions(PermissionKey.ORDERS_CREATE)
  async createProduct(
    @Param('id') id: string,
    @Body(new ZodPipe(catalogNodeSchema)) body: CatalogNode,
  ) {
    return { data: await this.catalog.createProduct(id, body.label) };
  }

  @Post('products/:id/questions')
  @RequirePermissions(PermissionKey.ORDERS_CREATE)
  async createQuestion(
    @Param('id') id: string,
    @Body(new ZodPipe(catalogNodeSchema)) body: CatalogNode,
  ) {
    return { data: await this.catalog.createQuestion(id, body.label) };
  }

  @Post('questions/:id/options')
  @RequirePermissions(PermissionKey.ORDERS_CREATE)
  async createOption(
    @Param('id') id: string,
    @Body(new ZodPipe(catalogOptionSchema)) body: CatalogOptionInput,
  ) {
    return { data: await this.catalog.createOption(id, body) };
  }

  @Patch('families/:id')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.CATALOG_MANAGE)
  async renameFamily(
    @Param('id') id: string,
    @Body(new ZodPipe(catalogNodeSchema)) body: CatalogNode,
  ): Promise<void> {
    await this.catalog.rename(CatalogFamilyEntity, id, { label: body.label });
  }

  @Patch('products/:id')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.CATALOG_MANAGE)
  async renameProduct(
    @Param('id') id: string,
    @Body(new ZodPipe(catalogNodeSchema)) body: CatalogNode,
  ): Promise<void> {
    await this.catalog.rename(CatalogProductEntity, id, { label: body.label });
  }

  @Patch('questions/:id')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.CATALOG_MANAGE)
  async renameQuestion(
    @Param('id') id: string,
    @Body(new ZodPipe(catalogNodeSchema)) body: CatalogNode,
  ): Promise<void> {
    await this.catalog.rename(CatalogQuestionEntity, id, { label: body.label });
  }

  @Patch('options/:id')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.CATALOG_MANAGE)
  async updateOption(
    @Param('id') id: string,
    @Body(new ZodPipe(catalogOptionSchema)) body: CatalogOptionInput,
  ): Promise<void> {
    await this.catalog.updateOption(id, body);
  }

  @Delete('families/:id')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.CATALOG_MANAGE)
  async deleteFamily(
    @Param('id') id: string,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.catalog.softDelete(CatalogFamilyEntity, id, user.email);
  }

  @Delete('products/:id')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.CATALOG_MANAGE)
  async deleteProduct(
    @Param('id') id: string,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.catalog.softDelete(CatalogProductEntity, id, user.email);
  }

  @Delete('questions/:id')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.CATALOG_MANAGE)
  async deleteQuestion(
    @Param('id') id: string,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.catalog.softDelete(CatalogQuestionEntity, id, user.email);
  }

  @Delete('options/:id')
  @HttpCode(204)
  @RequirePermissions(PermissionKey.CATALOG_MANAGE)
  async deleteOption(
    @Param('id') id: string,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.catalog.softDelete(CatalogOptionEntity, id, user.email);
  }
}
