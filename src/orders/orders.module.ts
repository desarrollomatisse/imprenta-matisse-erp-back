import { Module } from '@nestjs/common';
import { ResponsiblesModule } from '../responsibles/responsibles.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TrackingController } from './tracking.controller';

@Module({
  imports: [ResponsiblesModule],
  controllers: [OrdersController, TrackingController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
