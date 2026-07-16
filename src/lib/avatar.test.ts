import { describe, it, expect } from 'vitest';
import { avatarColor, initials, validateAvatarFile, squareCropRect } from './avatar';

describe('avatarColor', () => {
  it('returns the same class for the same email every time', () => {
    expect(avatarColor('leo@optinetsolutions.com')).toBe(avatarColor('leo@optinetsolutions.com'));
  });

  it('returns a Tailwind bg-* class', () => {
    expect(avatarColor('leo@optinetsolutions.com')).toMatch(/^bg-\w+-500$/);
  });
});

describe('initials', () => {
  it('returns the first two characters, uppercased', () => {
    expect(initials('leo@optinetsolutions.com')).toBe('LE');
  });
});

describe('validateAvatarFile', () => {
  it('accepts a small PNG', () => {
    const file = new File([new Uint8Array(1024)], 'photo.png', { type: 'image/png' });
    expect(validateAvatarFile(file)).toBeNull();
  });

  it('accepts JPEG and WebP too', () => {
    const jpeg = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });
    const webp = new File([new Uint8Array(1024)], 'photo.webp', { type: 'image/webp' });
    expect(validateAvatarFile(jpeg)).toBeNull();
    expect(validateAvatarFile(webp)).toBeNull();
  });

  it('rejects a non-image type', () => {
    const file = new File([new Uint8Array(1024)], 'doc.pdf', { type: 'application/pdf' });
    expect(validateAvatarFile(file)).toBe('Please choose a PNG, JPEG, or WebP image.');
  });

  it('rejects a file over 15MB', () => {
    const file = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect(validateAvatarFile(file)).toBe('Image must be 15MB or smaller.');
  });
});

describe('squareCropRect', () => {
  it('centers a square crop on a landscape image', () => {
    expect(squareCropRect(400, 200)).toEqual({ sx: 100, sy: 0, size: 200 });
  });

  it('centers a square crop on a portrait image', () => {
    expect(squareCropRect(200, 400)).toEqual({ sx: 0, sy: 100, size: 200 });
  });

  it('returns the full image for an already-square image', () => {
    expect(squareCropRect(300, 300)).toEqual({ sx: 0, sy: 0, size: 300 });
  });
});
