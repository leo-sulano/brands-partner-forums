/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_IMPORT_TABS_URL: string;
  readonly VITE_PUSH_TO_SHEET_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
