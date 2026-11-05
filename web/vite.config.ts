import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const certKey = path.resolve(import.meta.dirname, 'certs/key.pem');
const certCrt = path.join(path.dirname(certKey), 'cert.pem');
// LAN HTTPS (geolocation needs a secure context): enabled automatically
// once `npm run dev:https` has generated certs/ (gitignored).
const httpsOptions =
  fs.existsSync(certKey) && fs.existsSync(certCrt)
    ? { key: fs.readFileSync(certKey), cert: fs.readFileSync(certCrt) }
    : undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'xlsx';
          if (id.includes('node_modules/jspdf')) return 'jspdf';
          if (id.includes('node_modules/docx')) return 'docx';
          if (id.includes('node_modules/recharts')) return 'recharts';
        },
      },
    },
  },
  server: {
    // The stable app port. In run mode Express serves the built app on 42780;
    // in dev mode Vite takes 42780 and proxies the API to 42781.
    port: Number(process.env.WEB_PORT || 42780),
    strictPort: true,
    https: httpsOptions,
    // Local dev parity with the old Next.js rewrites: forward API + socket
    // traffic to the Express server. VITE_API_PORT overrides the target port.
    // Production static hosting calls the absolute VITE_API_URL instead.
    proxy: {
      '/api': `http://localhost:${process.env.VITE_API_PORT || '42781'}`,
      '/socket.io': { target: `ws://localhost:${process.env.VITE_API_PORT || '42781'}`, ws: true },
    },
  },
});
