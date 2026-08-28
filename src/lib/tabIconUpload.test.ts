import { describe, it, expect } from 'vitest';
import { validateTabIconFile } from './tabIconUpload';

describe('validateTabIconFile', () => {
  it('accepts a small PNG', () => {
    const file = new File([new Uint8Array(1024)], 'icon.png', { type: 'image/png' });
    expect(validateTabIconFile(file)).toBeNull();
  });

  it('accepts JPEG and WebP too', () => {
    const jpeg = new File([new Uint8Array(1024)], 'icon.jpg', { type: 'image/jpeg' });
    const webp = new File([new Uint8Array(1024)], 'icon.webp', { type: 'image/webp' });
    expect(validateTabIconFile(jpeg)).toBeNull();
    expect(validateTabIconFile(webp)).toBeNull();
  });

  it('rejects a non-image type', () => {
    const file = new File([new Uint8Array(1024)], 'doc.pdf', { type: 'application/pdf' });
    expect(validateTabIconFile(file)).toBe('Please choose a PNG, JPEG, or WebP image.');
  });

  it('rejects a file over 15MB', () => {
    const file = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect(validateTabIconFile(file)).toBe('Image must be 15MB or smaller.');
  });
});
