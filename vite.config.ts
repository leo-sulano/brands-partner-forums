import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    // BIF-Dashboard is a separate project's checkout that happens to live inside
    // this repo's directory tree; without this, Vitest's default glob sweeps up
    // its test files too and runs them under this project's config/environment.
    exclude: [...configDefaults.exclude, 'BIF-Dashboard/**'],
  },
});
