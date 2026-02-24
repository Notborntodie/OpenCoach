import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.LLM_API_KEY': JSON.stringify(env.LLM_API_KEY),
      'process.env.LLM_BASE_URL': JSON.stringify(env.LLM_BASE_URL),
      'process.env.LLM_MODEL_ID': JSON.stringify(env.LLM_MODEL_ID || env.LLM_MODE_ID || 'qwen3.5-plus'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // 开发时代理 LLM 请求，避免浏览器 CORS 且不暴露 API Key
      proxy: env.LLM_API_KEY && env.LLM_BASE_URL
        ? {
            '/api/llm': {
              target: env.LLM_BASE_URL.replace(/\/$/, ''),
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api\/llm/, ''),
              configure: (proxy) => {
                proxy.on('proxyReq', (proxyReq) => {
                  proxyReq.setHeader('Authorization', `Bearer ${env.LLM_API_KEY}`);
                });
              },
            },
          }
        : undefined,
    },
  };
});
