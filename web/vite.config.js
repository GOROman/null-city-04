import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        viewer: fileURLToPath(new URL('./index.html', import.meta.url)),
        joyCheck: fileURLToPath(new URL('./joy-check.html', import.meta.url)),
      },
    },
  },
});
