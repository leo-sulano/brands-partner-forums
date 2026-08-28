// src/lib/tabIconUpload.ts
// Client-side validate/compress for the "Upload image" icon source
// (IconPicker.tsx) — mirrors src/lib/avatar.ts's compressAvatarImage/
// validateAvatarFile shape deliberately kept as a separate small file rather
// than a shared abstraction: avatar.ts is a stable, already-security-reviewed
// feature, and the two functions' bodies are each only a dozen lines. Reuses
// avatar.ts's squareCropRect directly since it's already a small, generic,
// already-exported pure function.
import { squareCropRect } from './avatar';

const TAB_ICON_TARGET_SIZE = 128;
const TAB_ICON_WEBP_QUALITY = 0.85;

export async function compressTabIconImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Could not process that image.');
  }

  const { sx, sy, size } = squareCropRect(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = TAB_ICON_TARGET_SIZE;
  canvas.height = TAB_ICON_TARGET_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not process that image.');
  }
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, TAB_ICON_TARGET_SIZE, TAB_ICON_TARGET_SIZE);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image.'))),
      'image/webp',
      TAB_ICON_WEBP_QUALITY,
    );
  });
}

const ACCEPTED_TAB_ICON_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_TAB_ICON_BYTES = 15 * 1024 * 1024;

export function validateTabIconFile(file: File): string | null {
  if (!ACCEPTED_TAB_ICON_TYPES.includes(file.type)) {
    return 'Please choose a PNG, JPEG, or WebP image.';
  }
  if (file.size > MAX_TAB_ICON_BYTES) {
    return 'Image must be 15MB or smaller.';
  }
  return null;
}
