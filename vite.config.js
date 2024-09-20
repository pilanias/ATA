import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  build: {
    target: 'esnext'
  },
  server: {
    port: 3000,
  },
  plugins: [
    nodePolyfills({
      // Whether to polyfill `Buffer`. Default: true
      buffer: true
    })
  ]
});
