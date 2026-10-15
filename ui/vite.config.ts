import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Proxy REST calls to backend in development
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
});