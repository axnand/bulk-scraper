# Bulk Scraper — Setup & Deployment Guide

## Architecture Overview

```
User creates job (POST /api/jobs)
  → Tasks saved to PostgreSQL
  → after() triggers /api/process-tasks immediately
    → Acquires accounts from pool, processes tasks in parallel
    → If more tasks remain, self-chains via after()
    → Safety-net cron re-triggers every 15 min if chain breaks
```

**Services needed:** Neon (PostgreSQL) + Vercel. That's it. No Redis, no workers.

---

## Step 1: Create a Neon Database

1. Go to [neon.tech](https://neon.tech) and sign up (free tier is fine)
2. Click **"New Project"** → pick a name and region
3. Once created, go to **Dashboard → Connection Details**
4. You need **two** connection strings:
   - **Pooled connection** (for your app) → this is your `DATABASE_URL`
   - **Direct connection** (for migrations) → click "Direct connection" toggle → this is your `DIRECT_URL`

Both look like: `postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`

The pooled one has `-pooler` in the hostname. The direct one does not.

---

## Step 2: Update Your .env

Open `.env` and fill in your real values:

```env
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require"

OPENAI_API_KEY="sk-proj-your-real-key"

UNIPILE_DSN="https://api36.unipile.com:16688"
UNIPILE_API_KEY="your-real-unipile-key"

CRON_SECRET="run-this-to-generate: openssl rand -hex 32"
```

To generate CRON_SECRET, run in terminal:
```bash
openssl rand -hex 32
```

---

## Step 3: Run the Database Migration

```bash
npx prisma migrate deploy
```

This creates the Account, Job, and Task tables in your Neon database.

Verify it worked:
```bash
npx prisma studio
```
This opens a browser UI showing your empty tables.

---

## Step 4: Test Locally

```bash
npm run dev
```

1. Open `http://localhost:3000/accounts`
2. Add a Unipile account (you need at least one to process tasks)
3. Go to `http://localhost:3000` and create a job with a few LinkedIn URLs
4. The job should start processing immediately (check terminal logs)

---

## Step 5: Deploy to Vercel

### 5a. Push to GitHub

```bash
git add -A
git commit -m "Ready for deployment"
git push origin main
```

### 5b. Import in Vercel

1. Go to [vercel.com](https://vercel.com) → **"Add New Project"**
2. Import your GitHub repo
3. Framework preset: **Next.js** (auto-detected)

### 5c. Set Environment Variables

In Vercel project → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon **pooled** connection string |
| `DIRECT_URL` | Your Neon **direct** connection string |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `UNIPILE_DSN` | `https://api36.unipile.com:16688` (or your Unipile DSN) |
| `UNIPILE_API_KEY` | Your Unipile API key (global fallback) |
| `CRON_SECRET` | The random string you generated |

**Optional:**
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Your custom domain (e.g. `https://scraper.yourdomain.com`) |

> Note: Vercel auto-sets `VERCEL_URL` so the app works without `NEXT_PUBLIC_APP_URL`.
> Only set it if you use a custom domain.

### 5d. Deploy

Click **Deploy**. Vercel runs `npm install` → `prisma generate` (via postinstall) → `next build`.

The migration was already run in Step 3. If you need to re-run it later:
```bash
npx prisma migrate deploy
```

---

## Step 6: Add Unipile Accounts

After deployment, go to `https://your-app.vercel.app/accounts` and add your Unipile accounts.

Each account has:
- **Account ID**: The Unipile `account_id` (from your Unipile dashboard)
- **Name**: A friendly label
- **DSN** (optional): Per-account Unipile DSN override
- **API Key** (optional): Per-account API key override

For 1,000 links/day with a daily limit of 100/account, you need **10+ accounts**.

---

## How Processing Works

1. You create a job with LinkedIn URLs via the UI
2. `POST /api/jobs` saves tasks to the database
3. `after()` immediately triggers `POST /api/process-tasks`
4. The processor:
   - Acquires available accounts (one per task, parallel)
   - Applies random jitter (500-1500ms) before each API call
   - Fetches LinkedIn profiles via Unipile
   - Runs AI analysis via OpenAI (if job description provided)
   - Exports to Google Sheets (if configured)
5. If more tasks remain, it self-chains via `after()`
6. Safety-net cron runs every 15 minutes to recover from any broken chains

---

## Rate Limiting

All rate limiting is in PostgreSQL (no Redis needed):

| Limit | Value | What happens |
|---|---|---|
| Per-minute per account | 10 requests | Account skipped until window resets |
| Daily per account | 100 requests | Account skipped until end of day |
| 429 from Unipile | 15 min cooldown | Account enters COOLDOWN status |

---

## Troubleshooting

**Jobs stuck in PENDING:**
- Check you have at least one ACTIVE account in `/accounts`
- Check Vercel function logs for errors
- The safety-net cron runs every 15 min and will recover stuck tasks

**Tasks stuck in PROCESSING:**
- The safety-net cron resets tasks stuck for >5 minutes
- BUSY accounts with no active tasks are also reset

**"Unauthorized" on process-tasks:**
- Make sure `CRON_SECRET` is set in Vercel env vars
- Vercel auto-sends this header for cron jobs

---

## Vercel Plan Notes

| Feature | Hobby (Free) | Pro ($20/mo) |
|---|---|---|
| Function timeout | 10 seconds | 60 seconds |
| Cron frequency | Once/day | Every minute (we use 15 min) |
| `after()` support | Yes | Yes |

The `after()` self-chain is the primary processing path and works on **both plans**.
On Hobby, each function invocation has 10s — enough for 1-2 tasks per cycle.
On Pro, 60s — enough for 5-10 tasks per cycle.
