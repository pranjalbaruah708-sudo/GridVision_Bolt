import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const STAGING_SUPABASE_HOST = 'fylnuppelaebrhqllzzh.supabase.co';
const PRODUCTION_SUPABASE_REF = 'eetlzxntgvjompmipprb';

export default defineConfig(({ mode }) => {
  if (mode === 'staging') {
    const stagingUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL?.trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(stagingUrl ?? '');
    } catch {
      throw new Error(`Staging mode requires VITE_SUPABASE_URL to be https://${STAGING_SUPABASE_HOST}.`);
    }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== STAGING_SUPABASE_HOST || (stagingUrl ?? '').includes(PRODUCTION_SUPABASE_REF)) {
      throw new Error(`Staging mode may only use https://${STAGING_SUPABASE_HOST}; production is forbidden.`);
    }
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
  };
});
