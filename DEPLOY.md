# Deploying MiniEdCRM for free

One free Render web service runs everything (API, web app and email worker), with a free Neon
Postgres database and free Brevo email. No Redis needed. Total cost: $0.

**What "free" means here**
- The app **sleeps after 15 minutes** without visitors. The first visit after that takes about a minute.
- Neon free: 1 GB storage, 100 compute-hours a month. Plenty for a class-sized institute.
- Brevo free: 300 emails a day.
- A GitHub Action wakes the app at 9:00 India time for the daily follow-up reminders.

## 1. Database: Neon

1. Sign up at [neon.com](https://neon.com) (no card needed) and create a project.
   Pick the **Singapore** region, the same as the Render service.
2. On the project dashboard, open **Connect**, turn **Connection pooling off**, and copy the connection string.
   It looks like `postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   - It must be the **direct** (non-pooled) string: the email queue listens for new jobs on its connection,
     which the pooler doesn't support.
3. Keep it somewhere private: it's the database password.

## 2. Email: Brevo

1. Sign up at [brevo.com](https://www.brevo.com) (free plan).
2. **Senders, domains & IPs → Senders**: add the address emails should come from (your Gmail works) and verify it.
3. **SMTP & API → SMTP**: generate an SMTP key. Note the login shown there (an address ending in `@smtp-brevo.com`).
4. Your `SMTP_URL` is `smtp://LOGIN:SMTP_KEY@smtp-relay.brevo.com:587`.
   If the login or key contains `@`, `:` or `/`, replace them with `%40`, `%3A`, `%2F`.

Without your own domain, some emails may land in spam. Ask people to check it the first time.

## 3. Create the first admin

New databases are empty. From this repo on your computer, create the tables on Neon and then the admin account.
In **PowerShell**, from the `server` folder:

```powershell
$env:DATABASE_URL = "<your Neon direct URL>"
npx prisma migrate deploy
$env:SEED_ADMIN_EMAIL = "you@example.com"
$env:SEED_ADMIN_PASSWORD = "<a strong password, 10+ characters>"
npm run db:seed
Remove-Item Env:DATABASE_URL, Env:SEED_ADMIN_EMAIL, Env:SEED_ADMIN_PASSWORD
```

The last line matters: until it runs, this terminal points at the live database.

For a database that isn't on your machine, the seed refuses to run without these two settings, refuses the
example passwords from `.env.example`, and skips the demo mentor unless you also set `SEED_MENTOR_EMAIL`
and `SEED_MENTOR_PASSWORD`.

## 4. The app: Render

1. Push the latest code to GitHub (`main`).
2. On [dashboard.render.com](https://dashboard.render.com): **New → Blueprint**, connect GitHub, pick this repository.
   Render reads `render.yaml` and proposes one free web service called `miniedcrm`.
3. Fill in the four secrets it asks for:

   | Setting | Value |
   | ------- | ----- |
   | `DATABASE_URL` | the Neon direct URL |
   | `CLIENT_URL` | `https://miniedcrm.onrender.com`. If that name is taken, Render shows the real address after creation: update this to match |
   | `SMTP_URL` | from step 2 |
   | `MAIL_FROM` | `MiniEdCRM <the-address-you-verified@gmail.com>` |

4. Apply. The first build takes a few minutes. When the service shows **Live**, open its address and sign in
   with the admin from step 3.

The app refuses to start if a production setting is unsafe (no `SMTP_URL`, a non-https `CLIENT_URL`, an example
`JWT_SECRET`) and says what to fix in the **Logs** tab.

## 5. Daily reminders: GitHub Actions

1. In Render, open the service's **Environment** tab and copy the generated `CRON_SECRET`.
2. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `APP_URL`: the site address, e.g. `https://miniedcrm.onrender.com`
   - `CRON_SECRET`: the value from Render
3. **Actions → Daily follow-up reminders → Run workflow** to test it once.

GitHub pauses scheduled workflows in repositories with no activity for 60 days; any push turns them back on.

## 6. Deploys from GitHub Actions

Render's auto-deploy is off in `render.yaml`. Instead, the CI workflow deploys only after the tests, the builds
and the Docker image all pass on `main`.

1. In Render, open the service's **Settings → Deploy Hook** and copy the URL. Treat it like a password.
2. On GitHub, add the repository secret `RENDER_DEPLOY_HOOK_URL` with that URL (`APP_URL` from step 5 is reused
   to check the site answers after the deploy).

Without the secret, the **Deploy** job just notes that nothing was deployed.

## 7. Payments (optional): Razorpay

Course-fee payments are off in production until you set them up.

1. Sign up at [razorpay.com](https://razorpay.com). **Test Mode** works straight away with no KYC; live
   payments need your business verified.
2. **Account & Settings → API Keys**: generate keys. Test keys start with `rzp_test_`.
3. **Account & Settings → Webhooks → Add**: URL `https://<your-app>/api/payments/webhook`, choose a secret,
   and tick `payment.captured` and `payment.failed`.
4. In Render's **Environment** tab add `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
   and `RAZORPAY_WEBHOOK_SECRET` (the webhook secret from step 3).
5. Payments must be captured automatically (Razorpay's default for orders), so the webhook reports
   `payment.captured`.

Try it in Test Mode with Razorpay's test cards or UPI id `success@razorpay` before switching to live keys.

## Updating

Push to `main` (or merge a pull request). CI runs the tests, then deploys; database migrations run automatically
on start. To deploy by hand, use **Manual Deploy** in Render.

## Checking it's healthy

`https://<your-app>/api/health` shows `{"status":"ok","db":"up","queue":"postgres","mail":"smtp",...}`.
