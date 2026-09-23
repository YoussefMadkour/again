/**
 * Who may generate a world, and how often.
 *
 * - Your own World Labs key: allowed, lightly rate limited per IP (it's their credits).
 * - Otherwise, generations use the owner's key and need an access code with quota left,
 *   plus a per-IP hourly limit and a global daily cap that protects the owner's credits.
 */
import type { Store } from "./store";

export interface AccessCode {
  code: string;
  /** Total generations this code may start. Infinity for `code:*`. */
  limit: number;
}

export interface Limits {
  /** Generations per day on the owner's key, across everyone. */
  daily: number;
  /** Per IP per hour, on the owner's key. */
  ipHourly: number;
  /** Per IP per hour, with the visitor's own key. */
  ownKeyIpHourly: number;
}

export interface AccessPolicy {
  codes: AccessCode[];
  limits: Limits;
  /** When false (mock mode without codes), anyone may generate. */
  requireCode: boolean;
}

export type Decision =
  | {
      ok: true;
      release: () => Promise<void>;
      usage: "own-key" | "code" | "open";
      remaining?: number;
    }
  | { ok: false; status: 401 | 403 | 429; error: string };

/** `ACCESS_CODES="trial-ana:1,judge:3,me:*"`. A code without a limit gets one generation. */
export function parseAccessCodes(raw: string | undefined): AccessCode[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [code, limit] = part.split(":").map((s) => s.trim());
      const n = limit === "*" ? Number.POSITIVE_INFINITY : Number.parseInt(limit ?? "1", 10);
      return { code, limit: Number.isFinite(n) || n === Number.POSITIVE_INFINITY ? n : 1 };
    })
    .filter((c) => c.code.length > 0);
}

export function accessPolicyFromEnv(env = process.env): AccessPolicy {
  const codes = parseAccessCodes(env.ACCESS_CODES);
  const int = (v: string | undefined, fallback: number) => {
    const n = Number.parseInt(v ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    codes,
    limits: {
      daily: int(env.DAILY_GENERATION_LIMIT, 5),
      ipHourly: int(env.IP_HOURLY_LIMIT, 3),
      ownKeyIpHourly: int(env.OWN_KEY_IP_HOURLY_LIMIT, 10),
    },
    requireCode: env.AI_MODE === "real" || codes.length > 0,
  };
}

export function findCode(policy: AccessPolicy, code: string | undefined): AccessCode | undefined {
  const wanted = code?.trim();
  if (!wanted) return undefined;
  return policy.codes.find((c) => c.code === wanted);
}

const HOUR = 3600;
const GUESSES_PER_HOUR = 10;
const DAY = 86400;

/**
 * Reserves one generation. Call `release()` if the generation then fails to start, so a
 * provider error doesn't eat someone's quota.
 */
export async function authorizeGeneration(
  input: { code?: string; ownKey: boolean; ip: string },
  policy: AccessPolicy,
  store: Store,
  now = new Date(),
): Promise<Decision> {
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const taken: string[] = [];
  const release = async () => {
    await Promise.all(taken.map((key) => store.incr(key, undefined, -1)));
  };
  const take = async (key: string, limit: number, ttl?: number) => {
    const used = await store.incr(key, ttl);
    taken.push(key);
    return used <= limit;
  };
  const deny = async (status: 403 | 429, error: string): Promise<Decision> => {
    await release();
    return { ok: false, status, error };
  };

  if (input.ownKey) {
    if (!(await take(`rl:own:${input.ip}:${hour}`, policy.limits.ownKeyIpHourly, HOUR))) {
      return deny(429, "too many memories this hour, try again later");
    }
    return { ok: true, release, usage: "own-key" };
  }

  if (!policy.requireCode) return { ok: true, release, usage: "open" };

  const code = findCode(policy, input.code);
  if (!input.code?.trim()) return { ok: false, status: 401, error: "this needs an access code" };
  if (!code) {
    // Wrong guesses count (and aren't released), so codes can't be brute-forced.
    const guesses = await store.incr(`rl:guess:${input.ip}:${hour}`, HOUR);
    if (guesses > GUESSES_PER_HOUR) {
      return { ok: false, status: 429, error: "too many tries, wait a while" };
    }
    return { ok: false, status: 403, error: "that access code isn't valid" };
  }

  if (!(await take(`quota:code:${code.code}`, code.limit))) {
    return deny(403, "this access code has been used up");
  }
  const unlimited = code.limit === Number.POSITIVE_INFINITY;
  if (!unlimited) {
    if (!(await take(`rl:ip:${input.ip}:${hour}`, policy.limits.ipHourly, HOUR))) {
      return deny(429, "too many memories this hour, try again later");
    }
    if (!(await take(`rl:day:${day}`, policy.limits.daily, DAY * 2))) {
      return deny(429, "AGAIN. has made all its memories for today, try again tomorrow");
    }
  }
  const used = (await store.get<number>(`quota:code:${code.code}`)) ?? 0;
  return {
    ok: true,
    release,
    usage: "code",
    remaining: unlimited ? undefined : Math.max(0, code.limit - used),
  };
}

/** First hop of X-Forwarded-For (set by Vercel), else a constant for local development. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}
