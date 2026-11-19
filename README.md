# TASKORA Pro — Client handoff starter

A multi-file productivity web app starter based on the original TASKORA to-do project. It includes a responsive dashboard, tasks, projects, Kanban board, calendar, Pomodoro timer, reports, themes, local demo mode, Supabase authentication/cloud storage, and a Khalti hosted-checkout integration.

> **Project status:** This is a development starter, not a live production service. The demo workspace works locally. Real accounts require a Supabase project and the SQL setup. Real payments require the merchant's approved Khalti account, server secrets, HTTPS deployment, and testing. No payment credentials are included.

## 1. What is included

- Email/password sign-up and sign-in through Supabase Auth; password reset flow.
- A local demo workspace so a client can preview the UI without backend accounts.
- Per-user cloud tasks and projects, using Supabase PostgreSQL and Row Level Security (RLS).
- Realtime task updates across signed-in browser sessions (after enabling the supplied schema/publication).
- Task descriptions, categories, priorities, due dates, status, project assignment, search, filters and sorting.
- Drag-and-drop Kanban columns and monthly calendar.
- Pomodoro focus timer with saved session history.
- Dashboard statistics, 7-day completion chart, overdue and due-today counts.
- Light/dark appearance, accent colors, browser due-date reminders while the tab is open.
- JSON backup/import and CSV export (CSV is Pro-gated for cloud accounts).
- Free tier limits: 50 active tasks and 2 active projects. Pro removes those limits and unlocks CSV export. Limits are checked in the database as well as the interface.
- Khalti ePayment hosted checkout, server-side lookup verification, order history, and manually renewed 30-day/365-day Pro access.

## 2. Preview the website (no Supabase needed)

You need Node.js 20.19+ or 22.12+ and npm.

1. Extract the ZIP file.
2. Open the extracted `TASKORA_PRO` folder in VS Code.
3. Open the VS Code terminal in that folder.
4. Run:

   ```bash
   npm install
   npm run dev
   ```

5. Open the local address printed by Vite (normally `http://localhost:5173`).
6. Choose **Open demo workspace**.

Demo data is saved only in that browser profile. It is not a real account, and it does not sync to other devices. The Express server is not needed for this preview.

## 3. Enable real accounts and cloud data

1. Create a Supabase project owned by the client/business.
2. In Supabase, open **SQL Editor**, paste the complete `supabase/schema.sql`, and run it.
3. In Supabase Authentication settings, configure the site's URL and allowed redirect URLs. For local development, include `http://localhost:5173`; for production, add the real HTTPS domain.
4. Copy `.env.example` to a new file named `.env` in the project root.
5. Fill in:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (or the publishable key accepted by the current Supabase JS client)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only; never prefix this with `VITE_` and never commit it)
   - `APP_URL=http://localhost:5173`
6. Keep two terminal windows open:

   Terminal A:
   ```bash
   npm run server
   ```

   Terminal B:
   ```bash
   npm run dev
   ```

7. Create a user from the TASKORA sign-up screen. If email confirmation is enabled, follow the confirmation email before signing in.

The Supabase service-role key bypasses RLS. It is only used by the Express server for trusted payment operations. Do not put it in front-end code, screenshots, GitHub, or a client-facing public file.

## 4. Configure Khalti sandbox payments

The integration uses Khalti KPG-2 hosted web checkout. The browser is redirected to Khalti's checkout page; TASKORA does not collect or store card or wallet credentials. The Express server creates the payment order and verifies the returned `pidx` through Khalti's lookup endpoint before activating Pro.

1. The client/business owner must obtain and manage the merchant account and complete Khalti's merchant onboarding/KYC.
2. Obtain the sandbox server secret from the merchant's Khalti sandbox dashboard.
3. Add it to the server-only `.env` file as `KHALTI_SECRET_KEY`.
4. Keep the default sandbox base URL:

   ```env
   KHALTI_BASE_URL=https://dev.khalti.com/api/v2
   ```

5. Configure the displayed prices in the server `.env`:

   ```env
   PRO_MONTHLY_NPR=499
   PRO_YEARLY_NPR=4999
   ```

6. Restart `npm run server` after changing `.env`.
7. Test the complete redirect → payment → return → server lookup flow in Khalti's sandbox. Verify success, cancel, pending and expired cases before launch.

**Production is deliberately not enabled by default.** Only after the merchant is approved, integration is tested, support/refund terms are ready, and the production site runs on HTTPS should the business owner change `KHALTI_BASE_URL` to `https://khalti.com/api/v2` and use their production secret. Never expose the secret in browser JavaScript. Do not use a personal wallet key as a merchant key.

### Payment model and limits

This starter implements one-time checkout for a 30-day or 365-day access period. Renewal is manual. It does **not** implement automatic recurring card/wallet billing, payment retries, proration, refund automation, tax invoices, or chargeback handling. Those require product and merchant decisions before launch.

Prices in the UI are read from `/api/config`, while the server calculates the payable amount from its own environment values. The client cannot set an arbitrary amount. The database function `complete_khalti_order` makes plan activation idempotent so refreshing the callback cannot add the same paid period twice.

## 5. Build for deployment

Build the front end:

```bash
npm run build
```

The production static website is generated in `dist/`. Deploy the static front end and Express API to hosting that supports Node.js. Configure the API's `APP_URL` to the exact front-end HTTPS origin and configure the Vite production API URL/proxy or serve the API and front end behind the same domain. Set production environment variables in the hosting provider's secret manager; do not upload `.env`.

For a same-origin deployment, configure the hosting/reverse proxy to route `/api/*` to the Express server and all other routes to the Vite `dist` output. Keep the Express API private to the intended domain and enforce HTTPS.

## 6. Plan limits

| Plan | Limits/features |
|---|---|
| Free | Up to 50 active tasks, up to 2 active projects, standard tasks/board/calendar/focus/basic reports, JSON backup |
| Pro | Unlimited tasks and projects, CSV report export, Pro subscription status and billing history |

Change these limits only after updating both the database trigger functions in `supabase/schema.sql` and the UI checks in `src/main.js`.

## 7. Important client launch work still required

Before selling/launching this as a production SaaS, the client must provide and approve: final brand assets, domain, final plan/pricing, privacy policy, terms of service, refund/cancellation policy, support contact, tax/invoice requirements, data retention/deletion policy, and the business merchant account. Add automated database backups, error monitoring, uptime monitoring, accessibility review, security review, and tests for account isolation and payment callbacks.

The current reminder feature uses browser Notifications while the website is open. It is not a guaranteed background push system when the browser is closed. A service worker + push provider and explicit permission workflow would be a separate enhancement.

## 8. Source layout

```text
TASKORA_PRO/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── README.md
├── src/
│   ├── main.js
│   ├── style.css
│   ├── supabase.js
│   └── api.js
├── server/
│   └── index.js
├── supabase/
│   └── schema.sql
├── docs/
│   └── CLIENT_HANDOFF.md
└── archive/
    └── TASKORA_2_0_legacy_single_file.html
```

## 9. Troubleshooting

- **Demo workspace opens but sign-up does not:** expected until the Supabase values are configured in `.env` and Vite has been restarted.
- **Database permission error:** rerun/check `supabase/schema.sql`, especially RLS and grants. Make sure the signed-in user owns the rows.
- **Payment endpoint says not configured:** check `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `KHALTI_SECRET_KEY` in the server `.env`, then restart `npm run server`.
- **Payment return does not activate Pro:** inspect the Express server terminal and Khalti sandbox dashboard. A browser redirect is not proof of payment; only a successful lookup with the exact order amount activates Pro.
- **Tasks do not sync:** check that `tasks` was added to the `supabase_realtime` publication, the user is signed in, and the Supabase project URL/key are correct.

## 10. License and ownership

This handoff contains original project source plus third-party open-source dependencies. The client should receive an agreed written license/ownership transfer for the custom code as part of the sale. Third-party dependencies remain under their own licenses. No API keys, credentials, customer records, or merchant secrets are included.
