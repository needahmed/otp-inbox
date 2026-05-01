# OTP Inbox

Automatically detect and display OTP codes, login codes, and verification codes from Gmail — so you never open Gmail manually for a 2FA code again.

## Architecture

```
otp-inbox/
├── backend/       Node.js + Express + Prisma + Redis
└── extension/     Chrome Extension (Manifest V3, React 18, Tailwind)
```

---

## 1. Google Cloud Setup

### Create a Google Cloud project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com) and create a new project.
2. Enable the **Gmail API**:
  APIs & Services → Library → search "Gmail API" → Enable.
3. Enable the **Google People API** (for userinfo):
  APIs & Services → Library → search "Google People API" → Enable.

### Create OAuth 2.0 credentials

1. APIs & Services → Credentials → Create Credentials → OAuth client ID.
2. Application type: **Web application**.
3. Authorized redirect URIs — add:
  - `http://localhost:3000/auth/google/callback` (local dev)
  - `https://your-production-domain.com/auth/google/callback`
4. Copy the **Client ID** and **Client Secret**.

### OAuth consent screen

1. APIs & Services → OAuth consent screen.
2. User type: **External**.
3. Add scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.readonly`.
4. Add your Gmail address as a test user while in development.

---

## 2. Backend Setup

### Prerequisites

- Node.js 20+
- Docker + Docker Compose (for local Postgres + Redis)

### Install and configure

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
EXTENSION_ID=your_extension_id   # fill in after loading extension
```

### Start services

```bash
# Start Postgres + Redis in Docker
docker compose up -d postgres redis
Start services

# Start Postgres + Redis in Docker
docker compose up -d postgres redis

# Generate Prisma client and run migrations
npx prisma generate
npx prisma migrate dev --name init

# Start the dev server
npm run dev
```

The server starts at `http://localhost:3000`.

### ngrok (for OAuth callbacks in local dev)

```bash
ngrok http 3000
```

Update `GOOGLE_REDIRECT_URI` and `BACKEND_URL` in `.env` with the ngrok HTTPS URL, and add the ngrok URL to your Google OAuth authorized redirect URIs.

### Production deployment (Railway / Render)

1. Push the `backend/` folder to a GitHub repo.
2. Create a new service on Railway or Render pointing at the repo.
3. Add all `.env` values as environment variables in the dashboard.
4. Set `DATABASE_URL` to a Neon or Supabase PostgreSQL connection string.
5. Set `REDIS_URL` to an Upstash Redis connection string.
6. After first deploy, run: `npx prisma migrate deploy`.

---

## 3. Chrome Extension Setup

### Prerequisites

- Node.js 20+

### Install and build

```bash
cd extension
npm install

# Development (auto-rebuilds on change)
npm run dev

# Production build
npm run build
```

The built extension lands in `extension/dist/`.

### Load into Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select the `extension/dist/` folder.
4. Copy the extension ID shown on the card (e.g. `abcdefghijklmnopqrstuvwxyz123456`).

### Wire up the extension ID

1. Paste the extension ID into `backend/.env`:
  ```
   EXTENSION_ID=abcdefghijklmnopqrstuvwxyz123456
  ```
2. Update `extension/src/utils/api.ts` — replace `https://your-backend-domain.com` with your actual backend URL.
3. Update `extension/manifest.json` — replace `https://your-backend-domain.com/*` in `host_permissions`.
4. Rebuild the extension: `npm run build`.
5. Reload it in `chrome://extensions` → click the ↺ refresh icon.

---

## 4. Connect a Gmail Account

1. Click the OTP Inbox extension icon in Chrome.
2. Click **Connect Gmail Account**.
3. Complete the Google OAuth flow.
4. The tab closes automatically and you're logged in.

---

## 5. Phase 2 — Real-time Push (Google Pub/Sub)

For sub-second delivery instead of 15-second polling:

1. In Google Cloud Console → Pub/Sub → Create a topic named `gmail-notifications`.
2. Create a push subscription pointing to `https://your-domain.com/webhooks/gmail`.
3. Grant the Gmail service account publish rights on the topic.
4. Add to `.env`:
  ```
   GOOGLE_CLOUD_PROJECT_ID=your_project_id
   PUBSUB_TOPIC=gmail-notifications
   PUBSUB_SUBSCRIPTION=gmail-push-sub
  ```
5. Restart the backend — it will call `users.watch()` for all active accounts on startup and auto-renew every 6 days.

---

## 6. Chrome Web Store Publishing

1. Build the extension: `cd extension && npm run build`.
2. Zip the `dist/` folder: `zip -r otp-inbox.zip dist/`.
3. Go to [https://chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole).
4. Pay the one-time $5 developer fee if you haven't.
5. Click **New Item** → upload `otp-inbox.zip`.
6. Fill in the store listing (description, screenshots, privacy policy).
7. Set the OAuth consent screen to **Production** in Google Cloud Console.
8. Submit for review (typically 1–3 business days).

---

## API Reference


| Method | Path                    | Auth   | Description            |
| ------ | ----------------------- | ------ | ---------------------- |
| GET    | `/health`               | —      | Health check           |
| GET    | `/auth/google`          | —      | Start OAuth flow       |
| GET    | `/auth/google/callback` | —      | OAuth callback         |
| POST   | `/auth/refresh`         | JWT    | Refresh access token   |
| POST   | `/auth/logout`          | JWT    | Revoke session         |
| GET    | `/auth/accounts`        | JWT    | List linked accounts   |
| GET    | `/codes`                | JWT    | Fetch recent OTP codes |
| PATCH  | `/codes/:id/copied`     | JWT    | Mark code as copied    |
| POST   | `/webhooks/gmail`       | Google | Pub/Sub push endpoint  |


---

## Security Notes

- OAuth tokens are encrypted at rest with AES-256-GCM before writing to PostgreSQL.
- The extension only stores a JWT in `chrome.storage.local` — never raw OAuth tokens.
- CORS is locked to `chrome-extension://<your-extension-id>` in production.
- Rate limiting: 100 req/min per IP, 20 req/min per authenticated user.
- JWT expiry: 7 days.
- The Gmail scope is read-only (`gmail.readonly`) — the backend never sends, deletes, or modifies email.

