// Deno's independent module graph never loads Vite's own ambient ImportMeta.env
// typing (src/vite-env.d.ts's `/// <reference types="vite/client" />`, which only
// exists in the frontend's tsc/Vite compilation). src/lib/supabase.ts's
// `import.meta.env?.VITE_X` accesses are runtime-safe under Deno (optional
// chaining short-circuits since import.meta has no real .env there — see Task 3's
// fix), but Deno's own type-checker doesn't know `.env` can exist on ImportMeta at
// all without this. Deliberately the loosest possible shape — Deno never actually
// reads any of these values, only type-checks the access.
interface ImportMeta {
  env?: Record<string, string | undefined>;
}
