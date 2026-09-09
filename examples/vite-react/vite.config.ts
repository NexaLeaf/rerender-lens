import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rerenderLens } from 'rerender-lens/vite';

export default defineConfig({
  plugins: [
    react(),
    // Starts rerender-lens before React on `/` only (plain.html stays library-free for the extension's
    // injection mode), tracks every memo plus the one un-memoized Row, and serves the panel at
    // http://localhost:5199/__rerender-lens/ so no extension is needed.
    rerenderLens({ trackAllMemoized: true, include: ['Row'], panel: true, pages: ['/', '/index.html', '/scale.html', '/modern.html'] }),
  ],
  // Only needed because this example links the library from the repo root.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5199, strictPort: true },
});
