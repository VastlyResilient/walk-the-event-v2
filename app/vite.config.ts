import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';

/**
 * The splat module (2.8 MB) is fetched on the intro but only evaluated while the intro is still up: an import()
 * whose download finished mid-walk evaluated there and froze the picture (60-1100 ms on a throttled phone on 4G).
 * Its hashed chunk name goes into the page so the app can download it into the HTTP cache without running it.
 */
function sparkChunkMeta(): Plugin {
  let base = '/';
  return {
    name: 'spark-chunk-meta',
    configResolved(c) { base = c.base; },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const ch = ctx.bundle && Object.values(ctx.bundle).find((c) => c.type === 'chunk' && /spark\.module/.test(c.fileName));
        return ch ? html.replace('</head>', `  <meta name="spark-chunk" content="${base}${ch.fileName}">\n</head>`) : html;
      },
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [sparkChunkMeta()],
  server: { port: 5299, strictPort: true, host: "127.0.0.1" },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        map: resolve(import.meta.dirname, 'map/index.html'),
        stations: resolve(import.meta.dirname, 'stations/index.html'),
        lab: resolve(import.meta.dirname, 'lab/index.html'),
      },
    },
  },
});
