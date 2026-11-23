import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const gatewayTarget =
    process.env.GATEWAY_API_TARGET || env.GATEWAY_API_TARGET;
  const authTarget =
    process.env.AUTH_API_TARGET || env.AUTH_API_TARGET || gatewayTarget;
  const orderTarget =
    process.env.ORDER_API_TARGET || env.ORDER_API_TARGET || gatewayTarget;
  const cookingTarget =
    process.env.COOKING_API_TARGET || env.COOKING_API_TARGET || gatewayTarget;
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/v1/menus': {
          target:
            process.env.MENU_API_TARGET ||
            env.MENU_API_TARGET ||
            gatewayTarget ||
            'http://127.0.0.1:8080',
          changeOrigin: true,
        },
        ...(authTarget
          ? { '/api/v1/auth': { target: authTarget, changeOrigin: false } }
          : {}),
        ...(orderTarget
          ? { '/api/v1/orders': { target: orderTarget, changeOrigin: false } }
          : {}),
        ...(cookingTarget
          ? {
              '/api/v1/cooking': { target: cookingTarget, changeOrigin: false },
            }
          : {}),
      },
    },
  };
});
