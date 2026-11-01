import { config } from 'dotenv';
import { z } from 'zod';

config({ quiet: true });

const SECOND_MS = 1000;

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8000),

  DATABASE_URL: z.string().trim().min(1),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECURE: z.stringbool().default(true),
  FRONTEND_ORIGIN: z
    .string()
    .trim()
    .transform((value) => value.replace(/\/+$/, ''))
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) && url.origin === value
        );
      } catch {
        return false;
      }
    }, 'FRONTEND_ORIGIN debe ser un origen http(s) sin ruta, query ni fragmento.'),

  // Proxies de confianza delante de la API. En 0, X-Forwarded-For se ignora y
  // nadie puede falsificar su IP para esquivar el rate limit.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: z.string().min(1),
  GOOGLE_DRIVE_FOLDER_NAME: z
    .string()
    .trim()
    .min(1)
    .default('Imprenta Matisse ERP'),

  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  MAX_UPLOAD_TOTAL_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  MAX_FILES_PER_HOUR: z.coerce.number().int().positive().default(30),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

export const env = {
  ...schema.parse(process.env),
  SESSION_TTL_MS: 12 * 60 * 60 * SECOND_MS,
  // Los navegadores limitan una cookie a 400 días; cada uso renueva el plazo.
  REMEMBERED_SESSION_TTL_MS: 400 * 24 * 60 * 60 * SECOND_MS,
  REFRESH_ROTATION_INTERVAL_MS: 24 * 60 * 60 * SECOND_MS,
  REFRESH_REUSE_GRACE_MS: 2 * 60 * SECOND_MS,
  HTTP_TIMEOUT_MS: 20 * SECOND_MS,
  DRIVE_UPLOAD_TIMEOUT_MS: 90 * SECOND_MS,
  DRIVE_DOWNLOAD_TIMEOUT_MS: 45 * SECOND_MS,
  DRIVE_TOKEN_REFRESH_MARGIN_MS: 60 * SECOND_MS,
  DRIVE_TOKEN_DEFAULT_TTL_MS: 3600 * SECOND_MS,
};
