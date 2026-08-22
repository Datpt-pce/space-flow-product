import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// BACKEND_HOST/BACKEND_PORT cho phep proxy tro sang service "backend" (port rieng) khi chay
// trong Docker Compose; mac dinh localhost:3001 khi chay native (npm run dev).
const backendUrl = `http://${process.env.BACKEND_HOST || 'localhost'}:${process.env.BACKEND_PORT || 3001}`;
// FRONTEND_PORT cho phep Docker doi port rieng (2612) ma khong anh huong dev native (5174).
const frontendPort = Number(process.env.FRONTEND_PORT) || 5174;
// ALLOWED_HOSTS: Vite 6 tu chan request co Host header la, khong roi vao localhost/IP LAN
// (chong DNS rebinding) — can khai bao ro domain that khi chay sau Cloudflare Tunnel/reverse
// proxy (vd ALLOWED_HOSTS=spaceflow.me.uk). Khong dat gi (mac dinh) = hanh vi cu, khong doi.
const allowedHosts = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(',').map(h => h.trim())
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: frontendPort,
    strictPort: true, // bao loi ro rang neu port dang bi chiem, khong am tham nhay port khac
    host: true,
    allowedHosts,
    proxy: {
      '/api': backendUrl,
      '/uploads': backendUrl,
      // Agent-relay WebSocket (backend/ws/agentServer.js) — can "ws: true" rieng vi dang ky
      // proxy dang shorthand string (nhu /api o tren) khong tu forward WebSocket upgrade.
      '/agent-ws': { target: backendUrl.replace(/^http/, 'ws'), ws: true },
    },
  },
});
