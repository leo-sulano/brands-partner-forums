# Avatar Upload: Auto-Convert to WebP + Compress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resize and re-encode a user's selected avatar photo to a 256×256 WebP client-side before it's uploaded, instead of storing the raw selected file as-is.

**Architecture:** Pure client-side, native Canvas API, no new dependency. A new `compressAvatarImage()` helper in `src/lib/avatar.ts` decodes the file, center-crops to a square, draws it into a fixed-size canvas, and encodes as WebP. `uploadAvatar()` and `handleAvatarChange` are updated to run the file through it before uploading.

**Tech Stack:** TypeScript, `createImageBitmap`, `HTMLCanvasElement`/`canvas.toBlob`, Vitest (node environment — no DOM/canvas available in tests).

## Global Constraints

- No new npm dependency — Canvas API only.
- Target size: 256×256, WebP quality 0.82 (fixed, no user-facing controls).
- `validateAvatarFile`'s type check (PNG/JPEG/WebP) is unchanged; only its size ceiling changes, from 2MB to 15MB.
- `uploadAvatar()`'s storage path/upsert/public-URL behavior is unchanged — only its parameter type and content-type source change.
- Spec: `docs/superpowers/specs/2026-07-16-avatar-webp-compression-design.md`.

---

### Task 1: Square-crop rect helper

**Files:**
- Modify: `src/lib/avatar.ts`
- Test: `src/lib/avatar.test.ts`

**Interfaces:**
- Produces: `squareCropRect(width: number, height: number): { sx: number; sy: number; size: number }` — the source rectangle (top-left corner + side length) of the largest centered square that fits inside a `width`×`height` image. Used by Task 3's `compressAvatarImage`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/avatar.test.ts` (new `describe` block, alongside the existing ones):

```typescript
import { avatarColor, initials, validateAvatarFile, squareCropRect } from './avatar';

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
```

(Just update the existing `import` line at the top of the file to include `squareCropRect` — don't duplicate the import statement.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- avatar.test.ts`
Expected: FAIL — `squareCropRect is not defined` / export not found.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/avatar.ts`, after `initials()` and before the `ACCEPTED_AVATAR_TYPES` block:

```typescript
export function squareCropRect(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: (width - size) / 2, sy: (height - size) / 2, size };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- avatar.test.ts`
Expected: PASS (all `squareCropRect` cases, plus every pre-existing test in the file still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/avatar.ts src/lib/avatar.test.ts
git commit -m "feat: add squareCropRect helper for avatar compression"
```

---

### Task 2: Raise the avatar file size ceiling to 15MB

**Files:**
- Modify: `src/lib/avatar.ts`
- Test: `src/lib/avatar.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `validateAvatarFile` unchanged in signature; only its size cap and message text change (both callers — `AdminUsers.tsx` — already just render the returned string, no change needed there).

**Context:** The 2MB cap existed to bound the *final* stored file. Once Task 3/4/5 land, compression bounds the final size instead, so this check only needs to reject pathologically large inputs before the browser attempts to decode them.

- [ ] **Step 1: Update the failing test first**

In `src/lib/avatar.test.ts`, replace the existing `'rejects a file over 2MB'` test:

```typescript
  it('rejects a file over 15MB', () => {
    const file = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect(validateAvatarFile(file)).toBe('Image must be 15MB or smaller.');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- avatar.test.ts`
Expected: FAIL — actual message is still `'Image must be 2MB or smaller.'` (created with a 15MB+1 byte file that today's 2MB cap would also reject, but with the old message text).

- [ ] **Step 3: Update the implementation**

In `src/lib/avatar.ts`, change:

```typescript
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
```

to:

```typescript
const MAX_AVATAR_BYTES = 15 * 1024 * 1024;
```

And in `validateAvatarFile`, change:

```typescript
  if (file.size > MAX_AVATAR_BYTES) {
    return 'Image must be 2MB or smaller.';
  }
```

to:

```typescript
  if (file.size > MAX_AVATAR_BYTES) {
    return 'Image must be 15MB or smaller.';
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- avatar.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avatar.ts src/lib/avatar.test.ts
git commit -m "feat: raise avatar upload size cap to 15MB ahead of client-side compression"
```

---

### Task 3: `compressAvatarImage` — decode, crop, resize, encode as WebP

**Files:**
- Modify: `src/lib/avatar.ts`

**Interfaces:**
- Consumes: `squareCropRect(width, height)` from Task 1.
- Produces: `compressAvatarImage(file: File): Promise<Blob>` — the compressed WebP blob. Used by Task 5's `handleAvatarChange`.

**Context:** This function needs `createImageBitmap` and `HTMLCanvasElement`, neither of which exist under this project's Vitest config (`environment: 'node'`, see `vite.config.ts`). There is no automated test for this task — it's verified manually in Task 5's end-to-end check. Do not attempt to add a jsdom/canvas polyfill dependency to test it; that's out of scope per the spec.

- [ ] **Step 1: Implement**

Add to `src/lib/avatar.ts`, after `squareCropRect`:

```typescript
const AVATAR_TARGET_SIZE = 256;
const AVATAR_WEBP_QUALITY = 0.82;

export async function compressAvatarImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not process that image.');
  }

  const { sx, sy, size } = squareCropRect(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_TARGET_SIZE;
  canvas.height = AVATAR_TARGET_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not process that image.');
  }
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_TARGET_SIZE, AVATAR_TARGET_SIZE);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image.'))),
      'image/webp',
      AVATAR_WEBP_QUALITY,
    );
  });
}
```

- [ ] **Step 2: Verify the project still builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (confirms `ImageBitmap`/canvas types resolve under the project's `lib` config — they're standard DOM types already available since the codebase is a React web app).

- [ ] **Step 3: Commit**

```bash
git add src/lib/avatar.ts
git commit -m "feat: add compressAvatarImage — crop/resize/encode avatar as WebP"
```

---

### Task 4: `uploadAvatar` accepts a `Blob` instead of a `File`

**Files:**
- Modify: `src/lib/queries.ts:802-811`

**Interfaces:**
- Consumes: none new.
- Produces: `uploadAvatar(userId: string, file: Blob): Promise<string>` — same return shape as before (public URL with cache-busting query param). Used by Task 5's `handleAvatarChange`.

**Context:** Current signature is `uploadAvatar(userId: string, file: File)`. `File` already extends `Blob`, so this is a widening of the accepted type, not a behavior change — `file.type` and the `.storage.from('avatars').upload(...)` call both work identically on a plain `Blob`.

- [ ] **Step 1: Update the signature**

In `src/lib/queries.ts`, change:

```typescript
export async function uploadAvatar(userId: string, file: File): Promise<string> {
```

to:

```typescript
export async function uploadAvatar(userId: string, file: Blob): Promise<string> {
```

No other line in the function body changes — `file.type` and `file` are used identically for a `Blob` as for a `File`.

- [ ] **Step 2: Verify the project builds**

Run: `npm run build`
Expected: succeeds (no other caller needs a signature change yet — Task 5 updates the one call site).

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat: widen uploadAvatar to accept any Blob, not just a File"
```

---

### Task 5: Wire compression into the upload flow + end-to-end verification

**Files:**
- Modify: `src/pages/AdminUsers.tsx`

**Interfaces:**
- Consumes: `compressAvatarImage(file: File): Promise<Blob>` from Task 3, `uploadAvatar(userId: string, file: Blob): Promise<string>` from Task 4.
- Produces: nothing new for other tasks — this is the final integration point.

- [ ] **Step 1: Update the import**

In `src/pages/AdminUsers.tsx`, change:

```typescript
import { avatarColor, initials, validateAvatarFile } from '../lib/avatar';
```

to:

```typescript
import { avatarColor, initials, validateAvatarFile, compressAvatarImage } from '../lib/avatar';
```

- [ ] **Step 2: Compress before upload in `handleAvatarChange`**

Change:

```typescript
    setUpdating(self.id);
    setError(null);
    try {
      const avatarUrl = await uploadAvatar(self.id, file);
      await updateOwnAvatar(avatarUrl);
      setProfiles((prev) => prev.map((p) => (p.id === self.id ? { ...p, avatar_url: avatarUrl } : p)));
      await refreshProfile();
```

to:

```typescript
    setUpdating(self.id);
    setError(null);
    try {
      const compressed = await compressAvatarImage(file);
      const avatarUrl = await uploadAvatar(self.id, compressed);
      await updateOwnAvatar(avatarUrl);
      setProfiles((prev) => prev.map((p) => (p.id === self.id ? { ...p, avatar_url: avatarUrl } : p)));
      await refreshProfile();
```

The existing `catch (err) { setError(err instanceof Error ? err.message : 'Photo upload failed'); }` block is unchanged — it already surfaces `compressAvatarImage`'s "Could not process that image." error the same way it surfaces an upload failure.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests plus Task 1/2's new/updated `avatar.test.ts` cases green.

- [ ] **Step 4: Run the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Manual end-to-end verification (required — this path has no automated coverage)**

1. Run `npm run dev`, log in, go to Admin — Users.
2. Click your own row's avatar, pick a real photo larger than a few hundred KB (ideally a few MB, non-square, e.g. a phone photo).
3. Confirm the row's avatar updates to the new photo without a page reload.
4. In the Supabase dashboard (Storage → `avatars` bucket → `<your-user-id>/avatar`), confirm the stored object's content-type is `image/webp` and its size is a small fraction of the original file (well under 100KB for a typical photo).
5. Refresh the page and confirm the Topbar's online-users avatar (top-right) also shows the new photo, not just the Admin Users table.
6. Try selecting a non-image file (e.g. a `.pdf` renamed to `.png` won't pass the type check anyway — instead, test the reject path by picking a file over 15MB) and confirm the existing error banner still appears correctly.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AdminUsers.tsx
git commit -m "feat: compress avatar photos to WebP client-side before upload"
```
