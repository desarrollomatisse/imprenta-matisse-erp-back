import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { GoogleDriveClient } from './google-drive.client';

@Module({
  imports: [OrdersModule],
  controllers: [FilesController],
  providers: [FilesService, GoogleDriveClient],
})
export class FilesModule {}
