import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorators';
import { RATE_RULES, RateLimitService } from '../rate-limit/rate-limit.service';
import { OrdersService } from './orders.service';

@Public()
@Controller('public/tracking')
export class TrackingController {
  constructor(
    private readonly orders: OrdersService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get(':code')
  async tracking(@Param('code') code: string, @Req() request: Request) {
    await this.rateLimit.consume(
      `tracking:${request.ip ?? 'desconocida'}`,
      RATE_RULES.tracking,
    );
    return { data: await this.orders.publicTracking(code) };
  }
}
