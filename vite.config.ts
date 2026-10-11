import { defineConfig } from 'vite';

// GitHub Pages serves the site under /<repo>/; local dev uses /.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/rc-heli-sim/' : '/',
  build: { target: 'es2022', sourcemap: true },
});
