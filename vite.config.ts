import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: { input: { popup: resolve('popup.html'), options: resolve('options.html') } },
  },
});
