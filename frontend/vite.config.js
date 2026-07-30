import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// BACKEND_HOST/BACKEND_PORT cho phep proxy tro sang service "backend" (port rieng) khi chay
// trong Docker Compose; mac dinh localhost:3001 khi chay native (npm run dev).
const backendUrl = `http://${process.env.BACKEND_HOST || 'localhost'}:${process.env.BACKEND_PORT || 3001}`;
// FRONTEND_PORT cho phep Docker doi port rieng (2612) ma khong anh huong dev native (5174).
const frontendPort = Number(process.env.FRONTEND_PORT) || 5174;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: frontendPort,
    strictPort: true, // bao loi ro rang neu port dang bi chiem, khong am tham nhay port khac
    host: true,
    proxy: {
      '/api': backendUrl,
      '/uploads': backendUrl,
    },
  },
});
