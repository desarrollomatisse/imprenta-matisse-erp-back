import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { MIN_PASSWORD_LENGTH } from '../domain/passwords';
import { RATE_RULES, RateLimitService } from '../rate-limit/rate-limit.service';
import { Public } from './auth.decorators';
import { AuthService, buildAuthStatus } from './auth.service';

const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 72;

const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(MAX_EMAIL_LENGTH).pipe(z.email()),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  remember: z.boolean().default(false),
});
type LoginBody = z.infer<typeof loginSchema>;

const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    .max(MAX_PASSWORD_LENGTH),
});
type ChangePasswordBody = z.infer<typeof changePasswordSchema>;

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('status')
  async status(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user } = await this.auth.resolveUser(request, response);
    return buildAuthStatus(user);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodPipe(loginSchema)) body: LoginBody,
  ) {
    this.auth.enforceOrigin(request);
    const user = await this.auth.login(
      body.email,
      body.password,
      body.remember,
      request.ip ?? 'desconocida',
      response,
    );
    return buildAuthStatus(user);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordBody,
  ) {
    this.auth.enforceOrigin(request);
    const { user } = await this.auth.resolveUser(request, response);
    if (!user) throw new UnauthorizedError('Inicia sesión para continuar.');
    await this.rateLimit.consume(
      `password:${user.email}`,
      RATE_RULES.passwordChange,
    );
    const updated = await this.auth.changePassword(
      user,
      body.currentPassword,
      body.newPassword,
      request,
      response,
    );
    return buildAuthStatus(updated);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.enforceOrigin(request);
    await this.auth.logout(request, response);
    return { authenticated: false };
  }
}
