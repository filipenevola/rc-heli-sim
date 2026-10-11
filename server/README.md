# Rankings server

Zero-dependency Node 22+ service (uses `node:sqlite`) that stores pilot profiles, verified emails and the
two rankings (longest clean flight, challenge points). Verification codes go out through Resend.

Run locally: `node server/index.mjs` (codes are printed to the console when `RESEND_API_KEY` is unset).

Deployed on Quave ONE (account `filipenevola`, app `rc-heli-sim-rankings`) with a persistent volume on `/data`.
Env: `RESEND_API_KEY`, `MAIL_FROM`, `CORS_ORIGIN=https://filipenevola.github.io`.
The web build points at it through `VITE_API_URL` (GitHub Actions variable).
