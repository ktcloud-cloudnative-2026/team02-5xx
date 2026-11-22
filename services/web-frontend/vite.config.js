import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const target =
    process.env.AUTH_API_TARGET ||
    loadEnv(mode, process.cwd(), '').AUTH_API_TARGET;
  return {
    plugins: [react()],
    // Opt-in developer transport only; no cookie rewriting or CSRF/CORS policy.
    server: target
      ? { proxy: { '/api/v1/auth': { target, changeOrigin: false } } }
      : {},
  };
});
