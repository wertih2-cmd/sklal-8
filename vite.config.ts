import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.png',
        'icons/app-icon-transparent-192.png', 'icons/app-icon-transparent-512.png', 'icons/maskable-512.png',
        'icons/sv-192.png', 'icons/sv-512.png', 'icons/sv-maskable-512.png',
        'icons/qr-192.png', 'icons/qr-512.png', 'icons/qr-maskable-512.png',
        'qr.html', 'sv.html', 'sv-install.html', 'qr-install.html',
      ],
      // Манифесты лежат в public/ (manifest.webmanifest, manifest-sv.webmanifest, manifest-qr.webmanifest):
      // у каждого приложения свой id, scope, имя и иконки.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/qr(\/|$)/, /\/qr\.html$/, /\/(sv|qr)-install\.html$/, /\/sv\.html$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        qr: fileURLToPath(new URL('./qr.html', import.meta.url)),
        sv: fileURLToPath(new URL('./sv.html', import.meta.url)),
        svInstall: fileURLToPath(new URL('./sv-install.html', import.meta.url)),
        qrInstall: fileURLToPath(new URL('./qr-install.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
