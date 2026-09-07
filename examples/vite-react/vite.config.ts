import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Only needed because this example links the library from the repo root.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5199, strictPort: true },
});
