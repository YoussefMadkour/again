/**
 * Tiny key-value store for quotas, job metadata and the gallery. Metadata only, never photos.
 *
 * - Upstash Redis (REST) when KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN are set.
 *   That's what Vercel's Upstash integration provides.
 * - Otherwise a JSON file (STORE_FILE, default .data/store.json) for local development.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  /** Atomically adds `by` and returns the new value. The TTL is set on first write. */
  incr(key: string, ttlSeconds?: number, by?: number): Promise<number>;
  del(key: string): Promise<void>;
  /** Sets `key` only if it's absent (a lock). True if this caller got it. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

export class RedisStore implements Store {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || json.error) throw new Error(`redis ${args[0]}: ${json.error ?? res.status}`);
    return json.result as T;
  }

  async get<T>(key: string) {
    const raw = await this.command<string | null>("GET", key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown, ttlSeconds?: number) {
    const args: (string | number)[] = ["SET", key, JSON.stringify(value)];
    if (ttlSeconds) args.push("EX", ttlSeconds);
    await this.command(...args);
  }

  async incr(key: string, ttlSeconds?: number, by = 1) {
    const value = await this.command<number>("INCRBY", key, by);
    if (ttlSeconds && value === by) await this.command("EXPIRE", key, ttlSeconds);
    return value;
  }

  async del(key: string) {
    await this.command("DEL", key);
  }

  async claim(key: string, ttlSeconds: number) {
    return (await this.command<string | null>("SET", key, "1", "NX", "EX", ttlSeconds)) === "OK";
  }
}

interface Entry {
  value: unknown;
  expiresAt?: number;
}

/** Local development only: one process, so a promise chain is enough to serialize writes. */
export class FileStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async load(): Promise<Record<string, Entry>> {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8")) as Record<string, Entry>;
      const now = Date.now();
      for (const [k, e] of Object.entries(data))
        if (e.expiresAt && e.expiresAt < now) delete data[k];
      return data;
    } catch {
      return {};
    }
  }

  private async save(data: Record<string, Entry>) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, this.path);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  get<T>(key: string) {
    return this.serial(async () => ((await this.load())[key]?.value as T) ?? null);
  }

  set(key: string, value: unknown, ttlSeconds?: number) {
    return this.serial(async () => {
      const data = await this.load();
      data[key] = { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined };
      await this.save(data);
    });
  }

  incr(key: string, ttlSeconds?: number, by = 1) {
    return this.serial(async () => {
      const data = await this.load();
      const existing = data[key];
      const value = ((existing?.value as number) ?? 0) + by;
      data[key] = {
        value,
        expiresAt: existing?.expiresAt ?? (ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined),
      };
      await this.save(data);
      return value;
    });
  }

  del(key: string) {
    return this.serial(async () => {
      const data = await this.load();
      delete data[key];
      await this.save(data);
    });
  }

  claim(key: string, ttlSeconds: number) {
    return this.serial(async () => {
      const data = await this.load();
      if (data[key]) return false;
      data[key] = { value: 1, expiresAt: Date.now() + ttlSeconds * 1000 };
      await this.save(data);
      return true;
    });
  }
}

/** For tests. */
export class MemoryStore implements Store {
  private data = new Map<string, Entry>();

  private live(key: string) {
    const e = this.data.get(key);
    if (e?.expiresAt && e.expiresAt < Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  async get<T>(key: string) {
    return (this.live(key)?.value as T) ?? null;
  }

  async set(key: string, value: unknown, ttlSeconds?: number) {
    this.data.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  async incr(key: string, ttlSeconds?: number, by = 1) {
    const e = this.live(key);
    const value = ((e?.value as number) ?? 0) + by;
    this.data.set(key, {
      value,
      expiresAt: e?.expiresAt ?? (ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined),
    });
    return value;
  }

  async del(key: string) {
    this.data.delete(key);
  }

  async claim(key: string, ttlSeconds: number) {
    if (this.live(key)) return false;
    this.data.set(key, { value: 1, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }
}

let store: Store | undefined;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    store = new RedisStore(url, token);
  } else if (process.env.VERCEL) {
    // Serverless file systems are read-only and per-instance: quotas would silently not work.
    throw new Error(
      "No store configured. Add Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN).",
    );
  } else {
    store = new FileStore(process.env.STORE_FILE ?? ".data/store.json");
  }
  return store;
}
