# RC Heli Sim: agent instructions

## Delivery: always push to main

Every change ends with a commit pushed straight to `main`; no branches, no PRs, no asking first. A push to `main`
deploys to production (https://heli.filipenevola.com) through `.github/workflows/quave-one.yml`, so the work is not
done until that deploy is green. Watch it with `gh run watch` / `gh run list` and fix forward if CI or the deploy fails.

Before pushing:

1. `git fetch` and start from `origin/main` (the local checkout can lag).
2. Bump `package.json` `version` and add a matching entry at the top of `CHANGELOG.md` (`tests/version.test.ts`
   enforces it). The commit subject is `<version>: <what changed>`.
3. `npm run build` and `npm test` pass.
4. For anything that touches the game start-up or rendering, run the browser smoke against a dev server:
   `npx vite --port 5199 --strictPort` then `scripts/smoke.sh http://localhost:5199`.
