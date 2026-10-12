import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // The sandbox preview is served from a *.e2b.app host; allow it through Vite's host check.
    allowedHosts: true,
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { target: 'es2020', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
