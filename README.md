# Health Vault

Private, multi-device app for storing yearly health reports (blood tests, dental, vision, GP…), extracting the numbers with AI, and tracking trends over time.

## Features
- Email + password accounts (bcrypt, httpOnly SameSite=Strict session cookie, rate-limited login, password change signs out other devices)
- Upload up to 10 PDFs/photos per report (take photos page by page) — validated by file signature, **encrypted at rest (AES-256-GCM)**; phone photos are auto-resized
- **AI extraction** (Claude): reads all files together in two passes (extract, then a “what did I miss?” check), pre-fills title, date, summary, results with reference ranges, written findings, plain-language explanations, and flags unreadable parts — you review before saving
- Auto-generated trend charts for every metric (time-scaled, normal-range band), “needs attention” first, tap for history + explanation; range gauges on every result
- **Ask AI** about your records (answers grounded only in your saved data)
- Export all data (JSON), delete account (erases everything)
- Responsive, installable PWA (phone, tablet, PC), dark mode, keyboard/screen-reader friendly
- Strict CSP, security headers, CSRF protection, per-user data isolation

## Production readiness for ~100 users
This app is suitable for a small public SaaS beta with roughly 100 users, as long as it runs behind HTTPS and you keep the data safely backed up.

### Recommended deployment shape for 100 users
- One app instance in Docker or a single VM/container
- HTTPS in front via Caddy, nginx, Cloudflare Tunnel, or a reverse proxy
- Persistent volume for `DATA_DIR` (SQLite + encrypted files)
- Daily backup of the whole data directory
- Keep `ENC_KEY` and `JWT_SECRET` in the environment, never in frontend code
- Public access key optional: `PUBLIC_ACCESS_MODE=required` + `PUBLIC_ACCESS_KEY`
- Free-only usage while validating traction: keep `FREE_RECORD_LIMIT=3`, `FREE_AI_LIMIT=5`

### Render deployment (recommended quick public launch)
This project is ready for a simple Render web service. Add the secrets in the Render dashboard and keep the disk mounted at `/data` so encrypted files and SQLite remain persistent.

1. Push this repo to GitHub
2. In Render, create a new `Web Service` from the repository
3. Use the included `render.yaml` config or set the service settings manually
4. Add the required env vars in the Render dashboard:
   - `NODE_ENV=production`
   - `PORT=10000`
   - `DATA_DIR=/data`
   - `JWT_SECRET=<random 32+ char secret>`
   - `ENC_KEY=<base64 32-byte key>`
   - `COOKIE_SECURE=true`
   - `TRUST_PROXY=1`
   - `ALLOW_REGISTRATION=true`
   - `PUBLIC_ACCESS_MODE=off`
   - `PUBLIC_ACCESS_KEY=<optional shared key>`
   - `ANTHROPIC_API_KEY=<optional>`
   - `FREE_RECORD_LIMIT=3`
   - `FREE_AI_LIMIT=5`
5. Attach a persistent disk mounted at `/data`
6. Deploy and confirm the `/healthz` URL responds with `200`

Render already provides HTTPS automatically for the public domain once you attach it. This is the fastest path to a live beta without custom server management.

### Production checklist
- Set `NODE_ENV=production`
- Set `COOKIE_SECURE=true`
- Set `ALLOW_REGISTRATION=true` only while sign-ups are open
- Back up `/data` and store the encryption key in a secure password manager or secret store
- Use a reverse proxy for TLS termination
- Keep app logs and backups separate from the runtime volume
- Keep the `.env` file out of git; use secret injection in deployment instead

### Backup procedure
Use the included backup helper script:

```bash
chmod +x scripts/backup.sh
./scripts/backup.sh
```

This creates a timestamped tarball in `./backups` containing the app data directory and the current environment file for disaster recovery.

## Deploy (Docker)
```bash
cp .env.example .env        # fill JWT_SECRET, ENC_KEY, ANTHROPIC_API_KEY
docker compose up -d --build
```
Serve it over **HTTPS** (Caddy / nginx / Cloudflare Tunnel / any PaaS) — the session cookie is `Secure` in production. Health check: `/healthz`.

Without Docker: `npm ci --omit=dev && NODE_ENV=production node server/index.js` (Node ≥ 20; set the same env vars).
Local trial: `npm install`, create `.env` (see `.env.example`, add `COOKIE_SECURE=false`), then `node --env-file=.env server/index.js` → http://localhost:3000

## Free-only SaaS + public URL
- Free tier: `FREE_RECORD_LIMIT` reports and `FREE_AI_LIMIT` AI reads.
- Public deployment: set `PUBLIC_ACCESS_MODE=required` and `PUBLIC_ACCESS_KEY=your-shared-key` to gate signup/login behind a server-side access key.
- Storage: all user records, encrypted files and SQLite metadata live on the server under `DATA_DIR` (default `./data`). The browser never stores the actual health data locally.
- For a public launch, keep keys and secrets in the server environment only — never expose them in client code or browser storage beyond the temporary access key accepted by the app.

## Operations
- **Backups:** back up the `/data` volume (SQLite `vault.db` + `files/`) **and** keep `ENC_KEY` somewhere safe. Without the key, files can’t be decrypted.
- **Closing sign-ups:** set `ALLOW_REGISTRATION=false` once your accounts exist.
- **Tests:** `npm test` (22 end-to-end security/functionality checks).
- **Scaling:** single-node SQLite is ideal for personal/family use. For many users, swap `server/db.js` for Postgres and the file store for S3.

## Privacy & limits
- AI features send the selected report (or your saved metrics for Q&A) to Anthropic’s API; nothing else leaves your server. Disable by leaving `ANTHROPIC_API_KEY` empty.
- AI can misread scans — always verify extracted numbers. Not medical advice.
- Passwords can’t be reset by email (no mail server configured); keep your login safe or add an SMTP reset flow.
