# Zenith CRM

CRM-style job management app for Zenith Roof Restorations and Replacements Pty Ltd, an Australian roofing company. Modeled loosely on ServiceM8, with custom features built for this client: client/job management, a materials & bundles catalog, per-job billing line items, job diary, mocked email/SMS communications, and invoicing with PDF generation.

## Tech Stack

- Frontend: Vite + React, React Router
- Backend: [Supabase](https://supabase.com) (Postgres + Auth + Storage), access controlled via Row-Level Security keyed off a `role` column (`admin` / `office` / `technician`)

## Local Setup

```bash
npm install
cp .env.example .env   # fill in your Supabase project URL and anon key
npm run dev
```

Required environment variables (see `.env.example`):

- `VITE_SUPABASE_URL` — your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — your Supabase project's anon/publishable key

## Scripts

- `npm run dev` — start the local dev server
- `npm run build` — production build (outputs to `dist/`)
- `npm run preview` — locally preview a production build
- `npm run lint` — run Oxlint

## Database

Schema, RLS policies, and storage config live under `supabase/`, applied directly against the Supabase project (no migration CLI in use). Historical changes are also tracked as dated SQL files under `supabase/migrations/`.

## Deployment

Deployed on Vercel. The app is a client-side SPA using `BrowserRouter`, so `vercel.json` includes a rewrite rule sending all paths to `index.html` — without it, a hard refresh or direct link to a non-root route (e.g. `/jobs/5`) would 404. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the Vercel project settings; build command is `npm run build`, output directory is `dist`.
