# From mock to real

`AI_MODE=mock` (the default) needs nothing: the "generated" world is the demo splat,
returned after ~9 seconds so you can watch the processing copy.

## Going real

1. Buy API credits at https://platform.worldlabs.ai/billing (API credits are separate from
   Marble app credits) and create a key at https://platform.worldlabs.ai/api-keys.
2. `.env.local`:
   ```
   AI_MODE=real
   WORLDLABS_API_KEY=...
   WORLDLABS_MODEL=marble-1.1        # or marble-1.0-draft while developing
   ```
3. Restart `pnpm dev`. The server validates config on the first request and fails loudly if
   the key is missing.

| Model | Credits per photo | ≈ USD | Time | Notes |
|---|---|---|---|---|
| `marble-1.1` | 1,580 | $1.26 | ~5 min | default |
| `marble-1.1-plus` | 1,580–3,080 | up to $2.46 | ~5 min+ | larger spaces |
| `marble-1.0-draft` | 230 | $0.18 | ~1 min | soft, good for development |

Check your balance (free): `curl https://api.worldlabs.ai/marble/v1/credits -H "WLT-Api-Key: $KEY"`

## Things that cost money

- Every photo dropped in real mode starts a paid generation.
- `pnpm test:e2e` always runs its own server with `AI_MODE=mock` on port 3100, so tests never spend credits.
- A generation in progress survives a page reload (the job id is kept in sessionStorage), so a
  reload never pays twice.
- To reopen a world you already paid for, open `/?world=<world_id>`. It uses the photo World Labs
  stored with the world. Nothing is uploaded or generated.
- `scripts/generate-world.ts <photo> [model]` generates from the command line (spends credits).

⚠️ `/api/world` has no auth or rate limiting. Don't deploy with `AI_MODE=real` to a public URL
without adding a gate, or anyone can spend your credits.
