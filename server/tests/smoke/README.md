# Smoke tests

End-to-end checks that call the real API over HTTP, one script per phase.
They create their own data (unique emails and batch names per run), so they
can be run again and again against the same dev database.

**Needs:** the database (`npm run db:local` or Docker), the seed accounts
(`npm run db:seed`) and the API (`npm run dev`).

```bash
npm run test:smoke                 # run everything, stops at the first failing file
node tests/smoke/2-leads.mjs       # or one file at a time
```

Set `API_URL` to test a different server (default `http://localhost:4000/api`).

The email checks (`3-batches-attendance`, `5-emails`) read the `.eml` files the API saves to
`server/.outbox`, so run the API without `SMTP_URL`. To also watch a failing email go through every
retry to `FAILED`, start the API with short retries: `EMAIL_RETRY_DELAY_MS=300 EMAIL_MAX_ATTEMPTS=3 npm run dev`.

`8-security` skips its rate-limit checks unless the API runs with `RATE_LIMIT_LOCAL=true`, because in development
requests from your own machine aren't rate limited.

These get replaced by a proper Vitest + Supertest suite in Phase 8.
