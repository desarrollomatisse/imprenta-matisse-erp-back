import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { RequirePermissions, User } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser } from '../domain/current-user';
import { PermissionKey } from '../domain/enums';
import {
  PermissionToggle,
  permissionToggleSchema,
  UserCreate,
  userCreateSchema,
  UserUpdate,
  userUpdateSchema,
} from './admin-users.schemas';
import { AdminUsersService } from './admin-users.service';

@Controller('admin/users')
@RequirePermissions(PermissionKey.USERS_MANAGE)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  async list() {
    return { data: await this.users.list() };
  }

  @Post()
  async add(
    @Body(new ZodPipe(userCreateSchema)) body: UserCreate,
    @User() user: CurrentUser,
  ) {
    return { data: await this.users.add(user, body) };
  }

  @Patch(':email')
  async update(
    @Param('email') email: string,
    @Body(new ZodPipe(userUpdateSchema)) body: UserUpdate,
    @User() user: CurrentUser,
  ) {
    return { data: await this.users.update(user, email, body) };
  }

  @Delete(':email')
  @HttpCode(204)
  async remove(
    @Param('email') email: string,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.users.remove(user, email);
  }

  @Get(':email/permissions')
  async permissions(@Param('email') email: string) {
    return { data: await this.users.permissions(email) };
  }

  @Put(':email/permissions/:permission')
  async setPermission(
    @Param('email') email: string,
    @Param('permission') permission: string,
    @Body(new ZodPipe(permissionToggleSchema)) body: PermissionToggle,
    @User() user: CurrentUser,
  ) {
    return {
      data: await this.users.setPermission(
        user,
        email,
        permission,
        body.enabled,
      ),
    };
  }

  @Post(':email/permissions/reset')
  @HttpCode(200)
  async resetPermissions(
    @Param('email') email: string,
    @User() user: CurrentUser,
  ) {
    return { data: await this.users.resetPermissions(user, email) };
  }

  @Post(':email/reset-password')
  @HttpCode(200)
  async resetPassword(
    @Param('email') email: string,
    @User() user: CurrentUser,
  ) {
    return { data: await this.users.resetPassword(user, email) };
  }
}
