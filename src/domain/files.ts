import { UnsupportedMediaTypeError } from '../common/errors';

const PDF_MIME = 'application/pdf';
const PDF_SIGNATURE = Buffer.from('%PDF-');

const HEIF_BRANDS = ['ftypheic', 'ftypheix', 'ftyphevc', 'ftypmif1'].map(
  (brand) => Buffer.from(brand),
);

const IMAGE_SIGNATURES: Record<string, Buffer[]> = {
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/gif': [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
  'image/bmp': [Buffer.from('BM')],
  'image/tiff': [
    Buffer.from([0x49, 0x49, 0x2a, 0x00]),
    Buffer.from([0x4d, 0x4d, 0x00, 0x2a]),
  ],
  'image/webp': [Buffer.from('RIFF')],
  'image/heic': HEIF_BRANDS,
  'image/heif': HEIF_BRANDS,
};

export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(IMAGE_SIGNATURES),
  PDF_MIME,
]);

const startsWith = (content: Buffer, signature: Buffer) =>
  content.subarray(0, signature.length).equals(signature);

export function validateFileSignature(mimeType: string, content: Buffer): void {
  const normalized = mimeType.toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalized)) {
    throw new UnsupportedMediaTypeError(
      'Solo se aceptan imágenes y archivos PDF.',
    );
  }
  if (normalized === PDF_MIME) {
    if (!startsWith(content, PDF_SIGNATURE)) {
      throw new UnsupportedMediaTypeError(
        'El contenido del archivo no corresponde a un PDF.',
      );
    }
    return;
  }
  const signatures = IMAGE_SIGNATURES[normalized];
  if (normalized === 'image/webp') {
    const isWebp =
      startsWith(content, signatures[0]) &&
      content.length >= 12 &&
      content.subarray(8, 12).toString('latin1') === 'WEBP';
    if (!isWebp) {
      throw new UnsupportedMediaTypeError(
        'El contenido del archivo no corresponde a una imagen WebP.',
      );
    }
    return;
  }
  if (normalized === 'image/heic' || normalized === 'image/heif') {
    const header = content.subarray(4, 12);
    if (!signatures.some((signature) => startsWith(header, signature))) {
      throw new UnsupportedMediaTypeError(
        'El contenido del archivo no corresponde a una imagen HEIC/HEIF.',
      );
    }
    return;
  }
  if (!signatures.some((signature) => startsWith(content, signature))) {
    throw new UnsupportedMediaTypeError(
      'El contenido del archivo no corresponde al tipo declarado.',
    );
  }
}
