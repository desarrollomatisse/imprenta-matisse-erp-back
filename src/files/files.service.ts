import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { auditContext } from '../audit/audit-context';
import {
  ConflictError,
  isUniqueViolation,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from '../common/errors';
import { env } from '../config/env';
import { OrderAttachmentEntity } from '../database/entities';
import { MAX_FILES_PER_UPLOAD } from '../domain/constants';
import { CurrentUser } from '../domain/current-user';
import { ALLOWED_MIME_TYPES, validateFileSignature } from '../domain/files';
import { attachmentDownloadUrl } from '../orders/orders.mapper';
import { ensureCanAttach, ensureOrderScope } from '../orders/orders.scope';
import { OrdersService } from '../orders/orders.service';
import {
  DriveDownload,
  DriveFile,
  GoogleDriveClient,
} from './google-drive.client';
import { UploadLimiter } from './upload-limiter';

const baseName = (filename: string) => filename.split(/[\\/]/).pop() ?? '';

const normalizeMime = (value: string) =>
  value.split(';', 1)[0].trim().toLowerCase();

function validateFiles(files: Express.Multer.File[]): void {
  if (files.length === 0) {
    throw new UnsupportedMediaTypeError('Adjunta al menos un archivo.');
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new UnsupportedMediaTypeError(
      `Puedes adjuntar hasta ${MAX_FILES_PER_UPLOAD} archivos por operación.`,
    );
  }
}

function validateContents(files: Express.Multer.File[]): void {
  let totalBytes = 0;
  for (const file of files) {
    const mimeType = normalizeMime(file.mimetype);
    if (!baseName(file.originalname) || !ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new UnsupportedMediaTypeError(
        'Solo se aceptan imágenes y archivos PDF.',
      );
    }
    if (file.size === 0 || file.size > env.MAX_UPLOAD_BYTES) {
      const sizeMb = Math.max(
        1,
        Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024)),
      );
      throw new PayloadTooLargeError(
        `Cada archivo debe pesar hasta ${sizeMb} MB.`,
      );
    }
    validateFileSignature(mimeType, file.buffer);
    totalBytes += file.size;
    if (totalBytes > env.MAX_UPLOAD_TOTAL_BYTES) {
      throw new PayloadTooLargeError(
        'El tamaño total de los archivos supera el límite permitido.',
      );
    }
  }
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly limiter = new UploadLimiter(env.MAX_FILES_PER_HOUR);

  constructor(
    private readonly db: DataSource,
    private readonly orders: OrdersService,
    private readonly drive: GoogleDriveClient,
  ) {}

  private async deleteUploaded(token: string, files: DriveFile[]) {
    for (const file of files) {
      try {
        await this.drive.delete(token, file.id);
      } catch (error) {
        this.logger.warn(
          `No se pudo limpiar un archivo subido a Drive: ${String(error)}`,
        );
      }
    }
  }

  async upload(
    user: CurrentUser,
    orderNumber: string,
    files: Express.Multer.File[],
  ) {
    validateFiles(files);
    ensureCanAttach(user);
    const order = await this.orders.findOrder(orderNumber);
    if (!order) {
      throw new NotFoundError(
        'No se encontró la orden para adjuntar archivos.',
      );
    }
    ensureOrderScope(user, order);
    this.limiter.check(user.email, files.length);
    validateContents(files);

    const token = await this.drive.accessToken();
    const created: DriveFile[] = [];
    try {
      const folderId = await this.drive.ensureFolder(token);
      for (const file of files) {
        created.push(
          await this.drive.upload(token, {
            folderId,
            filename: baseName(file.originalname),
            mimeType: file.mimetype,
            orderNumber: order.number,
            content: file.buffer,
          }),
        );
      }
    } catch (error) {
      this.drive.invalidateFolder();
      await this.deleteUploaded(token, created);
      throw error;
    }

    const responses = created.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: attachmentDownloadUrl(file.id),
    }));
    try {
      await this.db.transaction((manager) =>
        manager.insert(
          OrderAttachmentEntity,
          responses.map((response) => ({
            ...response,
            orderId: order.id,
            eventId: null,
            createdAt: new Date(),
          })),
        ),
      );
    } catch (error) {
      await this.deleteUploaded(token, created);
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'No se pudieron registrar los adjuntos en la orden.',
        );
      }
      throw error;
    }
    return responses;
  }

  async open(
    user: CurrentUser,
    fileId: string,
  ): Promise<{
    download: DriveDownload;
    contentType: string;
    filename: string;
  }> {
    // El identificador de Drive nunca autoriza por sí solo: el archivo debe
    // estar registrado en una orden que el rol pueda ver.
    const attachment = await this.db.manager.findOneBy(OrderAttachmentEntity, {
      id: fileId,
    });
    const notFound = new NotFoundError('No se encontró el archivo solicitado.');
    if (!attachment) throw notFound;
    const order = await this.orders.findOrder(attachment.orderId);
    if (!order) throw notFound;
    ensureOrderScope(user, order);

    // Abrir un archivo del cliente también deja huella, aunque no cambie nada.
    const audit = auditContext();
    if (audit) {
      audit.logRead = true;
      audit.orderId = order.id;
    }

    const token = await this.drive.accessToken();
    const download = await this.drive.openDownload(token, fileId);
    const storedType = normalizeMime(attachment.mimeType);
    const contentType = ALLOWED_MIME_TYPES.has(storedType)
      ? storedType
      : download.contentType;
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      download.close();
      throw new UnsupportedMediaTypeError(
        'El tipo de archivo no está permitido.',
      );
    }
    return { download, contentType, filename: attachment.name };
  }
}
