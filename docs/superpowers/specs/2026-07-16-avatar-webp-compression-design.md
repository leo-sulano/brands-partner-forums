# Avatar Upload: Auto-Convert to WebP + Compress

## Problem

Profile photo upload ([2026-07-16-user-profile-photo-design.md](2026-07-16-user-profile-photo-design.md)) stores the raw selected file as-is (PNG/JPEG/WebP, up to 2MB). A phone camera photo can easily be several MB despite only ever being displayed as a 24-32px circle — wasted storage and slower loads for no visual benefit. Photos should be resized and re-encoded as WebP client-side before upload.

## Design

### 1. Compression helper

New `compressAvatarImage(file: File): Promise<Blob>` in [avatar.ts](../../../src/lib/avatar.ts):

1. Decode the file via `createImageBitmap(file)` (honors EXIF rotation).
2. Center-crop to a square using the shorter of width/height (matches the circular, `object-cover` display already used everywhere avatars render).
3. Draw into a 256×256 canvas.
4. Encode via `canvas.toBlob(cb, 'image/webp', 0.82)`, wrapped in a Promise.

No new dependency — native Canvas API only. If `createImageBitmap` rejects (corrupt/unreadable image), the returned promise rejects and the caller's existing catch block shows "Could not process that image."

### 2. Validation cap changes

`validateAvatarFile` in `avatar.ts` keeps its PNG/JPEG/WebP type check unchanged, but `MAX_AVATAR_BYTES` moves from 2MB to 15MB. That check now only guards against pathologically large inputs (which could be slow/heavy for the browser to decode) — it no longer needs to bound the final stored size, since compression does that.

### 3. Upload path

- `uploadAvatar(userId: string, file: Blob): Promise<string>` in [queries.ts](../../../src/lib/queries.ts) — parameter type changes from `File` to `Blob`; `contentType` is taken from `file.type` (now always `image/webp`) rather than assumed from the original selection. Storage path/upsert behavior unchanged.
- `handleAvatarChange` in [AdminUsers.tsx](../../../src/pages/AdminUsers.tsx) calls `compressAvatarImage(file)` right after `validateAvatarFile` passes, then uploads the resulting blob instead of the raw `File`.

### 4. Compatibility

Existing `avatar_url` values already stored as PNG/JPEG keep rendering exactly as before (`<img>` doesn't care about format) — only new uploads produce WebP.

## Out of scope

- No change to Topbar's own display logic (it already just renders whatever `avatar_url` points to).
- No user-facing quality/crop controls — crop and quality are fixed.
- No retroactive re-compression of already-stored avatars.
- No change to the storage bucket/RLS policies from the original profile-photo spec.

## Testing

- The crop/resize math (computing the square source rect from arbitrary width/height) is pulled into a small pure helper and unit-tested with vitest — no DOM/canvas needed for that part.
- The actual `createImageBitmap`/canvas draw/`toBlob` encode path cannot run under this project's vitest config (`environment: 'node'`, no DOM) — verified manually instead: upload a real multi-MB photo in the browser, confirm the object that lands in Supabase Storage is `image/webp` and a small fraction of the original size, and that it still displays correctly (Admin Users table, Topbar online-users stack).
- Corrupt/non-decodable file selected (e.g. a renamed non-image with an image extension, if it slips past the type check): upload shows the existing error banner rather than throwing unhandled.
- Very large source image (near the new 15MB cap): compresses and uploads without hanging the UI.
