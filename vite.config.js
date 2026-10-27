import { defineConfig } from 'vite';
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
export default defineConfig(({mode}) => ({
  cacheDir: `node_modules/.vite-${mode}`,
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  server: { headers },
  preview: { headers },
}));
