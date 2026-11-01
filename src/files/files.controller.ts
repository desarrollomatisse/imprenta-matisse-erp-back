import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { runInAuditContext } from '../audit/audit-context';
import { User } from '../auth/auth.decorators';
import { AppRequest } from '../auth/session';
import { ZodPipe } from '../common/zod.pipe';
import { env } from '../config/env';
import { MAX_FILES_PER_UPLOAD } from '../domain/constants';
import { CurrentUser } from '../domain/current-user';
import { FilesService } from './files.service';

const uploadSchema = z.object({
  order_number: z.string().trim().min(1).max(80),
});
type UploadBody = z.infer<typeof uploadSchema>;

const fileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

function contentDisposition(filename: string): string {
  const safeName = (filename.split(/[\\/]/).pop() ?? '')
    .replace(/[\r\n]/g, '')
    .trim();
  if (!safeName) return 'inline';
  const fallback = safeName
    .replace(/[^\x20-\x7e]/g, '?')
    .replaceAll('"', "'")
    .replaceAll('\\', '_');
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

/**
 * El cliente solo conoce URLs de esta API. Las credenciales y el acceso a
 * Google Drive permanecen en el backend.
 */
@Controller()
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(private readonly files: FilesService) {}

  @Post('archivos')
  @HttpCode(200)
  @UseInterceptors(
    // El máximo se excede en uno para responder con el mensaje del servicio.
    FilesInterceptor('files', MAX_FILES_PER_UPLOAD + 1, {
      limits: { fileSize: env.MAX_UPLOAD_BYTES + 1 },
      defParamCharset: 'utf8',
    } as Parameters<typeof FilesInterceptor>[2]),
  )
  async upload(
    @Req() request: AppRequest,
    @Body(new ZodPipe(uploadSchema)) body: UploadBody,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @User() user: CurrentUser,
  ) {
    const upload = () =>
      this.files.upload(user, body.order_number, files ?? []);
    // Multer termina en un evento del socket y ahí se pierde el contexto.
    const { auditContext } = request;
    return {
      files: await (auditContext
        ? runInAuditContext(auditContext, upload)
        : upload()),
    };
  }

  @Get('archivos/:fileId/descargar')
  async download(
    @Param('fileId', new ZodPipe(fileIdSchema)) fileId: string,
    @User() user: CurrentUser,
    @Res() response: Response,
  ): Promise<void> {
    const { download, contentType, filename } = await this.files.open(
      user,
      fileId,
    );
    response.set({
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Content-Disposition': contentDisposition(filename),
    });
    if (download.contentLength !== null) {
      response.set('Content-Length', String(download.contentLength));
    }
    try {
      await pipeline(download.stream, response);
    } catch (error) {
      // La respuesta ya empezó: solo queda registrar y cerrar con Drive.
      this.logger.warn(`Se interrumpió una descarga: ${String(error)}`);
      download.close();
    }
  }
}
