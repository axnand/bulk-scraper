# Bulk LinkedIn Profile Scraper & AI Analyzer

A Next.js application that scrapes LinkedIn profiles in bulk via [Unipile](https://www.unipile.com/) and optionally runs AI-powered candidate analysis using OpenAI. Results can be exported to Google Sheets automatically.

## What It Does

1. **Bulk Scrape** — Paste up to 1000 LinkedIn profile URLs, and the system scrapes them in parallel using multiple Unipile accounts with built-in rate limiting, cooldowns, and retries.
2. **AI Analysis** — Optionally score candidates against a job description using GPT-4.1. Configurable scoring rules (stability, growth, graduation tier, company type, MBA, skill match, location) plus custom rules.
3. **Google Sheets Export** — Automatically append results to a Google Sheet, organized by JD title tabs.
4. **Account Pool Management** — Rotate across multiple Unipile-linked LinkedIn accounts with per-minute and daily rate limits to avoid detection.

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** database (we recommend [Neon](https://neon.tech/) — free tier works)
- **Unipile account** — Sign up at [unipile.com](https://www.unipile.com/), connect your LinkedIn account(s), and get your API key and DSN
- **OpenAI API key** — Required only if you want AI candidate analysis
- **Google Apps Script Web App URL** — Required only if you want Google Sheets export

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd bulk-scraper
npm install
```

### 2. Configure environment variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

```env
# ─── Database (Neon PostgreSQL) ───────────────────────────
# Get both URLs from neon.tech -> your project -> Connection Details
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
DIRECT_URL="postgresql://user:password@host/dbname?sslmode=require"

# ─── OpenAI (required for AI analysis) ───────────────────
OPENAI_API_KEY="sk-proj-..."

# ─── Unipile (fallback if accounts don't have their own keys)
# UNIPILE_DSN="https://api1.unipile.com:13337"
# UNIPILE_API_KEY="your-unipile-api-key"

# ─── Security ────────────────────────────────────────────
# Protects internal processing endpoints
# Generate with: openssl rand -hex 32
CRON_SECRET="your-random-secret-here"

# ─── Data Retention ──────────────────────────────────────
# Days to keep raw profile data. Set to 0 to keep forever.
DATA_RETENTION_DAYS=7
```

### 3. Set up the database

```bash
npx prisma db push
```

### 4. Add your Unipile accounts

Once the app is running, go to the **Accounts** page in the UI to add your Unipile-linked LinkedIn accounts. You'll need:

- **Account ID** — Found in your Unipile dashboard under connected accounts
- **DSN** — Your Unipile API host (e.g., `https://api1.unipile.com:13337`)
- **API Key** — Your Unipile API key

You can add multiple accounts to increase throughput. The system automatically rotates between them with rate limiting.

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. **Paste LinkedIn URLs** — One per line in the text area (supports up to 1000)
2. **Configure analysis** (optional) — Select a JD template, paste a job description, configure scoring rules
3. **Submit** — The system processes profiles in parallel batches
4. **View results** — Click into the job to see scraped profiles, AI scores, and candidate details
5. **Sheet export** — If configured, results are automatically appended to your Google Sheet under the JD title tab

## Deploying to Vercel

```bash
vercel deploy
```

Make sure to:
- Add all environment variables in Vercel project settings
- Set up a cron job for the safety-net endpoint at `/api/cron/process-tasks` (every 15 minutes)

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/process-tasks",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

## Tech Stack

- **Next.js 16** — App Router, Server Actions, `after()` API
- **Prisma** — ORM with PostgreSQL
- **Unipile API** — LinkedIn profile data
- **OpenAI GPT-4.1** — Candidate scoring and analysis
- **Tailwind CSS** — UI styling
