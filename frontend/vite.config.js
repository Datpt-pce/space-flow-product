import path from 'path';
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
  resolve: {
    alias: {
      // Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md): shared/
      // video-commands/ lives at the repo root (backend requires it directly, no bundler
      // involved) and is written as plain CommonJS (module.exports = {...}). A bare-specifier
      // alias + optimizeDeps.include below is required for Vite's dev server to interop that
      // correctly — a raw relative/`/@fs/` import of a local (non-node_modules) CommonJS file
      // does NOT get esbuild's CJS->ESM named-export conversion at all (confirmed empirically:
      // it serves the file completely unconverted, `require(...)` calls and all, and a dynamic
      // import then fails with "does not provide an export named ..." the first time something
      // actually tries a named import) — only node_modules deps (or things explicitly forced via
      // optimizeDeps.include, which is what this alias exists to enable) get that treatment.
      '@shared/video-commands': path.resolve(__dirname, '../shared/video-commands/index.js'),
      // Phase 5 (04-video-editor.md): shared/video-transform.js — same CommonJS-at-repo-root
      // pattern as @shared/video-commands above, needing the exact same alias +
      // optimizeDeps.include + build.commonjsOptions.include trio (see that entry's own comments
      // for why each piece is required — this repeats them rather than genuinely duplicating
      // logic, since Vite's interop config is inherently per-module).
      '@shared/video-transform': path.resolve(__dirname, '../shared/video-transform.js'),
      '@shared/video-vector': path.resolve(__dirname, '../shared/video-vector.js'),
      '@shared/video-mask': path.resolve(__dirname, '../shared/video-mask.js'),
      '@shared/video-chroma': path.resolve(__dirname, '../shared/video-chroma.js'),
      // Phase 7 (04-video-editor.md): shared/video-keyframes.js — same trio again. Its own
      // `require('./video-easing')` does NOT need a separate alias entry, same reason
      // @shared/video-commands/index.js's sibling command-file requires don't either: esbuild's
      // dep-optimizer bundles a pre-bundled entry's own local requires recursively.
      '@shared/video-keyframes': path.resolve(__dirname, '../shared/video-keyframes.js'),
      '@shared/video-document-diff': path.resolve(__dirname, '../shared/video-document-diff.js'),
      '@shared/video-compound': path.resolve(__dirname, '../shared/video-compound.js'),
    },
  },
  optimizeDeps: {
    include: ['@shared/video-commands', '@shared/video-transform', '@shared/video-vector', '@shared/video-mask', '@shared/video-chroma', '@shared/video-keyframes', '@shared/video-document-diff', '@shared/video-compound'],
  },
  build: {
    commonjsOptions: {
      // Phase 3 (specs/space-flow-master-plan/04-video-editor.md) is the first real UI wiring
      // that pulls @shared/video-commands into a PRODUCTION build (`vite build`), and it failed
      // the exact way Phase 1's own hand-off notes flagged as an unexercised risk: Rollup's
      // default commonjsOptions.include is `[/node_modules/]` — a local path outside node_modules
      // (this alias, see resolve.alias above) never gets CJS->ESM named-export interop at build
      // time, even though optimizeDeps.include already covers the DEV server. Explicitly
      // including the real (non-aliased) file path here fixes `vite build` to match dev behavior.
      include: [/shared\/video-commands/, /shared\/video-transform/, /shared\/video-vector/, /shared\/video-mask/, /shared\/video-chroma/, /shared\/video-keyframes/, /shared\/video-document-diff/, /shared\/video-compound/, /node_modules/],
    },
  },
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
