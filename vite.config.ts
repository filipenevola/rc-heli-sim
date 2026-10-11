import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

const sha = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();
const build = `${sha} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

// GitHub Pages serves the site under /<repo>/; local dev uses /.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/rc-heli-sim/' : '/',
  define: { __BUILD__: JSON.stringify(build) },
  build: { target: 'es2022', sourcemap: true },
});
