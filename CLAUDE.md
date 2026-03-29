# Bulk Scraper — Claude Code Instructions

## Project Overview
Next.js 16 app that bulk-scrapes LinkedIn profiles via Unipile API and runs AI candidate analysis via OpenAI. Results export to Google Sheets.

## Architecture
- **app/api/jobs/** — Create and list scraping jobs
- **app/api/process-tasks/** — Core processing engine. Processes tasks in batches, self-chains via `after()` until all tasks are done
- **app/api/cron/process-tasks/** — Safety-net cron (every 15 min) to recover stuck tasks
- **app/api/accounts/** — Manage Unipile LinkedIn account pool
- **lib/services/account.service.ts** — Account pool rotation, rate limiting, cooldowns
- **lib/services/unipile.service.ts** — Unipile API client for LinkedIn profile fetching
- **lib/analyzer.ts** — OpenAI-powered candidate scoring
- **lib/sheets.ts** — Google Sheets export via Apps Script Web App
- **lib/config.ts** — Rate limits, concurrency, retry settings
- **lib/validators.ts** — URL validation and deduplication

## Database
PostgreSQL via Neon, ORM is Prisma. Key models: Account, Job, Task, CandidateProfile, AnalysisRecord.

## Key Patterns
- Tasks process in parallel batches (concurrency = available accounts)
- `after()` self-chaining triggers next batch until `remaining === 0`
- Accounts rotate with per-minute and daily rate limits
- Stale tasks/accounts auto-recover via `recoverStaleState()`
- Jobs and tasks use optimistic locking for concurrent safety

## Constraints
- Max ~1000 profiles per job, up to 10 accounts
- Vercel serverless: 60s max function duration
- Don't add QStash or external queues — the after() chain is intentional
- LinkedIn image URLs must be proxied via /api/proxy-image (CDN blocks cross-origin)
