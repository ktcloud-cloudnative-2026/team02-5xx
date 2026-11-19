import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v1/menus': {
        target:
          process.env.MENU_API_TARGET ||
          loadEnv(mode, process.cwd(), '').MENU_API_TARGET ||
          'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
}));
