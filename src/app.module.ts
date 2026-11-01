import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { AuditMiddleware } from './audit/audit.middleware';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { dataSourceOptions } from './database/data-source';
import { FilesModule } from './files/files.module';
import { HealthController } from './health.controller';
import { OrdersModule } from './orders/orders.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { ResponsiblesModule } from './responsibles/responsibles.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(dataSourceOptions),
    AuditModule,
    RateLimitModule,
    AuthModule,
    OrdersModule,
    ResponsiblesModule,
    FilesModule,
    AdminUsersModule,
    CatalogModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditMiddleware).forRoutes('{*splat}');
  }
}
