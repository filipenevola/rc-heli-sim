import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

// Build stamp: git when available, else public/version.txt (written by CI before a Docker build), else 'dev'.
const sha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    try {
      return readFileSync('public/version.txt', 'utf8').trim();
    } catch {
      return 'dev';
    }
  }
})();
const build = `${sha} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

// GitHub Pages serves the site under /<repo>/; local dev uses /.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/rc-heli-sim/' : '/',
  define: { __BUILD__: JSON.stringify(build), __VERSION__: JSON.stringify(pkg.version), __COMMIT__: JSON.stringify(sha) },
  build: { target: 'es2022', sourcemap: true, rollupOptions: { input: { main: 'index.html', radio: 'radio.html' } } },
});
