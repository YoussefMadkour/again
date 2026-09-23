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

## Access codes, visitors' own keys, rate limits

In real mode, generating on **your** key needs an access code:

```
ACCESS_CODES=again-yours:*,trial-ana:1,judge-3:3   # code:limit, "*" = unlimited
DAILY_GENERATION_LIMIT=3        # your key, everyone combined, per day
IP_HOURLY_LIMIT=2               # your key, per visitor IP, per hour
OWN_KEY_IP_HOURLY_LIMIT=10      # visitors using their own key, per IP, per hour
NEXT_PUBLIC_CONTACT_URL=https://x.com/<you>   # "ask for a trial" link
```

- A code's quota is used when a generation **starts**. If World Labs refuses the request, it's
  given back. Unlimited codes skip the IP and daily limits.
- Wrong codes are limited to 10 guesses per IP per hour.
- A code that worked is remembered on that device (localStorage).
- **Visitors' own keys**: sent with their request, used only for that request, never stored on
  the server or logged. The browser keeps it in sessionStorage for that tab, so a reload can
  resume polling. They pay World Labs directly.
- If `WORLDLABS_API_KEY` isn't set, the app only accepts visitors' own keys.

Limits live in the store: Upstash Redis when `KV_REST_API_URL` / `KV_REST_API_TOKEN` are set
(Vercel → Storage → Upstash), else `.data/store.json`. **On Vercel the app refuses to run without
Redis**, because per-instance memory wouldn't enforce anything.

## Gallery

Opt-in per memory: the "add this memory to the public gallery" checkbox, off by default. The
entry stores the world's public CDN URLs (photo, splat, panorama, thumbnail), so opening it at
`/?memory=<id>` needs no key and costs nothing.

```bash
tsx --env-file=.env.local scripts/gallery.ts list
tsx --env-file=.env.local scripts/gallery.ts add <world_id>       # one of your worlds
tsx --env-file=.env.local scripts/gallery.ts remove <gallery_id>
```

Removing an entry hides it from the gallery. The world itself stays on World Labs' CDN, where
anyone who already has its URL can still reach it.
