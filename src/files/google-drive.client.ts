import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { NotFoundError, ServiceUnavailableError } from '../common/errors';
import { env } from '../config/env';

const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

const CONNECTION_ERROR =
  'No se pudo conectar con el almacenamiento de archivos.';
const INVALID_RESPONSE =
  'El almacenamiento de archivos no devolvió una respuesta válida.';

export type DriveFile = { id: string; name: string; mimeType: string };

export type DriveDownload = {
  stream: Readable;
  contentType: string;
  contentLength: number | null;
  close: () => void;
};

type JsonBody = Record<string, unknown>;

const normalizeMime = (value: string | null | undefined) =>
  (value || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase();

const positiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/** Cliente de Google Drive para los adjuntos de órdenes. */
@Injectable()
export class GoogleDriveClient {
  private readonly logger = new Logger(GoogleDriveClient.name);
  private token: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;
  private folderRequest: Promise<string> | null = null;

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logger.warn(`Fallo de red con Google: ${String(error)}`);
      throw new ServiceUnavailableError(CONNECTION_ERROR);
    }
    if (!response.ok) {
      this.logger.warn(`Google respondió ${response.status}`);
      throw new ServiceUnavailableError(CONNECTION_ERROR);
    }
    return response;
  }

  private async json(
    url: string,
    init: RequestInit,
    timeoutMs: number = env.HTTP_TIMEOUT_MS,
  ): Promise<JsonBody> {
    const response = await this.request(url, init, timeoutMs);
    try {
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
        return body as JsonBody;
      }
    } catch {
      // Se responde igual que ante cualquier otro cuerpo inválido.
    }
    throw new ServiceUnavailableError(INVALID_RESPONSE);
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  /** Comparte la misma renovación entre peticiones simultáneas. */
  accessToken(): Promise<string> {
    if (
      this.token &&
      Date.now() < this.token.expiresAt - env.DRIVE_TOKEN_REFRESH_MARGIN_MS
    ) {
      return Promise.resolve(this.token.value);
    }
    this.tokenRequest ??= this.refreshToken().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async refreshToken(): Promise<string> {
    const data = await this.json(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new ServiceUnavailableError(
        'El almacenamiento de archivos no devolvió un token válido.',
      );
    }
    const ttlSeconds = positiveInt(data.expires_in);
    this.token = {
      value: data.access_token,
      expiresAt:
        Date.now() +
        (ttlSeconds ? ttlSeconds * 1000 : env.DRIVE_TOKEN_DEFAULT_TTL_MS),
    };
    return data.access_token;
  }

  /** Cachea la carpeta; una subida fallida la invalida con `invalidateFolder`. */
  ensureFolder(token: string): Promise<string> {
    this.folderRequest ??= this.lookupFolder(token).catch((error: unknown) => {
      this.folderRequest = null;
      throw error;
    });
    return this.folderRequest;
  }

  invalidateFolder(): void {
    this.folderRequest = null;
  }

  private async lookupFolder(token: string): Promise<string> {
    const name = env.GOOGLE_DRIVE_FOLDER_NAME;
    const escaped = name.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
    const query = new URLSearchParams({
      q: `name = '${escaped}' and mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`,
      spaces: 'drive',
      pageSize: '10',
      fields: 'files(id,name)',
    });
    const found = await this.json(`${GOOGLE_DRIVE_API}/files?${query}`, {
      headers: this.authHeaders(token),
    });
    const files = Array.isArray(found.files)
      ? (found.files as { id?: unknown }[])
      : [];
    if (files[0]?.id) return String(files[0].id);

    const created = await this.json(`${GOOGLE_DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(token),
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ name, mimeType: GOOGLE_FOLDER_MIME }),
    });
    if (!created.id) {
      throw new ServiceUnavailableError(
        'No se pudo preparar el almacenamiento de archivos.',
      );
    }
    return String(created.id);
  }

  async upload(
    token: string,
    file: {
      folderId: string;
      filename: string;
      mimeType: string;
      orderNumber: string;
      content: Buffer;
    },
  ): Promise<DriveFile> {
    const mimeType = normalizeMime(file.mimeType);
    const query = new URLSearchParams({
      uploadType: 'resumable',
      supportsAllDrives: 'true',
      fields: 'id,name,mimeType',
    });
    const session = await this.request(
      `${GOOGLE_DRIVE_UPLOAD_API}/files?${query}`,
      {
        method: 'POST',
        headers: {
          ...this.authHeaders(token),
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(file.content.length),
        },
        body: JSON.stringify({
          name: `${file.orderNumber} - ${file.filename}`,
          mimeType,
          parents: [file.folderId],
          description: `Adjunto de la orden ${file.orderNumber}`,
        }),
      },
      env.HTTP_TIMEOUT_MS,
    );
    const uploadUrl = session.headers.get('location');
    if (!uploadUrl) {
      throw new ServiceUnavailableError(
        'El almacenamiento de archivos no devolvió la sesión de subida.',
      );
    }
    const uploaded = await this.json(
      uploadUrl,
      {
        method: 'PUT',
        headers: { ...this.authHeaders(token), 'Content-Type': mimeType },
        body: new Uint8Array(file.content),
      },
      env.DRIVE_UPLOAD_TIMEOUT_MS,
    );
    if (!uploaded.id) {
      throw new ServiceUnavailableError(
        'El almacenamiento de archivos no devolvió el archivo.',
      );
    }
    return {
      id: String(uploaded.id),
      name: String(uploaded.name ?? file.filename),
      mimeType: String(uploaded.mimeType ?? mimeType),
    };
  }

  async delete(token: string, fileId: string): Promise<void> {
    await this.request(
      `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      { method: 'DELETE', headers: this.authHeaders(token) },
      env.HTTP_TIMEOUT_MS,
    );
  }

  /** Abre la descarga por bloques; el tiempo límite solo cubre el arranque. */
  async openDownload(token: string, fileId: string): Promise<DriveDownload> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      env.DRIVE_DOWNLOAD_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(
        `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
        { headers: this.authHeaders(token), signal: controller.signal },
      );
    } catch {
      throw new ServiceUnavailableError(CONNECTION_ERROR);
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 404) {
      throw new NotFoundError(
        'El archivo ya no está disponible en el almacenamiento.',
      );
    }
    if (!response.ok || !response.body) {
      throw new ServiceUnavailableError(CONNECTION_ERROR);
    }
    return {
      stream: Readable.fromWeb(response.body as ReadableStream),
      contentType: normalizeMime(response.headers.get('content-type')),
      contentLength: positiveInt(response.headers.get('content-length')),
      close: () => controller.abort(),
    };
  }
}
