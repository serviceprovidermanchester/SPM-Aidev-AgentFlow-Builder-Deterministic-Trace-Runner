# AgentFlow Backend

Built by **SPManchester Private Limited** (https://spmanchester.com/)  
Author: **Sayed Mudassar Akbar** (info@spmanchester.com)

Zero-dependency Node.js backend (`node:http`, `node:sqlite`, `node:crypto`
only) plus the workflow runner engine in `src/ai/engine.js` and the static
web console it serves from `../../web`.

```bash
node src/server.js          # PORT env, default 4000
curl localhost:4000/health
node ../../tests/run-tests.js   # from the product root: tests/run-tests.js
```

Layout: `src/server.js` (HTTP server) · `src/app.js` (router, `/health`,
static serving) · `src/db.js` (SQLite schema) · `src/seed.js` +
`src/seed-data.js` (seeded showcase workspace, shared run start/approve
execution) · `src/ai/engine.js` (tool registry, safe calculator parser,
deterministic runner with guardrails) · `src/middleware/` (token auth,
errors, validation) · `src/routes/` (`auth.js`, `workflows.js`, `misc.js`)
· `src/utils/` (JSON responses, password hashing and tokens).
