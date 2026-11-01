import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PermissionKey } from '../domain/enums';
import { AuditFilters, auditFiltersSchema } from './audit.schemas';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PermissionKey.AUDIT_READ)
  async list(@Query(new ZodPipe(auditFiltersSchema)) filters: AuditFilters) {
    return { data: await this.audit.list(filters) };
  }
}
