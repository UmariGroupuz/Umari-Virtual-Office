import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Explicit IPv4 target: `localhost` may resolve to ::1 and miss a 127.0.0.1-bound server (R-9, ADR-013).
const API_TARGET = 'http://127.0.0.1:4000';

// SEC-5 (ADR-037): the app must not be framed by other pages (clickjacking).
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // SEC-1 (ADR-037): no Vite CORS layer. Its default allows any localhost/127.0.0.1 origin on any port and
    // would bypass the backend's CORS_ORIGINS allowlist for proxied /api requests. The app is same-origin.
    cors: false,
    headers: SECURITY_HEADERS,
    proxy: {
      '/api': { target: API_TARGET },
      '/socket.io': { target: API_TARGET, ws: true },
    },
  },
  // `vite preview` reuses server.proxy by default; CORS and headers are set explicitly.
  preview: {
    port: 4173,
    strictPort: true,
    cors: false,
    headers: SECURITY_HEADERS,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The lazily loaded Phaser office chunk is ~1.2 MB minified (ADR-025, R-5); it is not on the first-paint
    // path, so raise the warning threshold just above it instead of warning on every build.
    chunkSizeWarningLimit: 1300,
  },
});
