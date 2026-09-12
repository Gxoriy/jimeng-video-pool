import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发代理：把 /api 转发到后端（携带凭证 Cookie）
export default defineConfig({
  plugins: [react()],
  // Electron 生产环境用 file:// 协议加载，相对路径才能正确解析 js/css 资源
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18000',
        changeOrigin: true,
        withCredentials: true,
      },
    },
  },
  // SPA 回退：非 /api 且非静态文件请求 → 返回 index.html（解决刷新 404）
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url || '';
      // 非 API 代理、无扩展名（或仅 .html）→ 回退到 index.html
      if (!url.startsWith('/api') && !url.includes('.') && url !== '/') {
        req.url = '/';
      }
      next();
    });
  },
});