const AVATAR_COLORS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
];

export function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function validateAvatarFile(file: File): string | null {
  if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
    return 'Please choose a PNG, JPEG, or WebP image.';
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return 'Image must be 2MB or smaller.';
  }
  return null;
}
