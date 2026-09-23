import { describe, expect, it } from "vitest";
import { type AccessPolicy, authorizeGeneration, parseAccessCodes } from "@/lib/access";
import { MemoryStore } from "@/lib/store";

const policy = (over: Partial<AccessPolicy> = {}): AccessPolicy => ({
  codes: parseAccessCodes("trial:1,judge:3,me:*"),
  limits: { daily: 5, ipHourly: 3, ownKeyIpHourly: 2 },
  requireCode: true,
  ...over,
});

const ask = (
  store: MemoryStore,
  input: Partial<{ code: string; ownKey: boolean; ip: string }>,
  p = policy(),
) => authorizeGeneration({ ownKey: false, ip: "1.1.1.1", ...input }, p, store);

describe("access codes", () => {
  it("parses limits, unlimited codes and defaults", () => {
    expect(parseAccessCodes(" a:2 , b , c:* ,")).toEqual([
      { code: "a", limit: 2 },
      { code: "b", limit: 1 },
      { code: "c", limit: Number.POSITIVE_INFINITY },
    ]);
  });

  it("needs a code on the owner's key, and rejects wrong ones", async () => {
    const store = new MemoryStore();
    expect(await ask(store, {})).toMatchObject({ ok: false, status: 401 });
    expect(await ask(store, { code: "nope" })).toMatchObject({ ok: false, status: 403 });
  });

  it("uses a trial code up", async () => {
    const store = new MemoryStore();
    expect(await ask(store, { code: "trial" })).toMatchObject({ ok: true, remaining: 0 });
    expect(await ask(store, { code: "trial" })).toMatchObject({
      ok: false,
      status: 403,
      error: expect.stringContaining("used up"),
    });
  });

  it("gives quota back when the generation fails to start", async () => {
    const store = new MemoryStore();
    const first = await ask(store, { code: "trial" });
    if (!first.ok) throw new Error("expected ok");
    await first.release();
    expect(await ask(store, { code: "trial" })).toMatchObject({ ok: true });
  });

  it("limits each IP per hour and everyone per day", async () => {
    const store = new MemoryStore();
    const p = policy({ codes: parseAccessCodes("big:100") });
    for (let i = 0; i < 3; i++) expect((await ask(store, { code: "big" }, p)).ok).toBe(true);
    expect(await ask(store, { code: "big" }, p)).toMatchObject({ ok: false, status: 429 });
    // Other IPs still work until the daily cap (5).
    expect((await ask(store, { code: "big", ip: "2.2.2.2" }, p)).ok).toBe(true);
    expect((await ask(store, { code: "big", ip: "3.3.3.3" }, p)).ok).toBe(true);
    expect(await ask(store, { code: "big", ip: "4.4.4.4" }, p)).toMatchObject({
      ok: false,
      error: expect.stringContaining("today"),
    });
  });

  it("a rejected request doesn't count against the code", async () => {
    const store = new MemoryStore();
    const p = policy({ limits: { daily: 0, ipHourly: 3, ownKeyIpHourly: 2 } });
    expect((await ask(store, { code: "trial" }, p)).ok).toBe(false);
    expect((await ask(store, { code: "trial" }, policy())).ok).toBe(true);
  });

  it("the owner's unlimited code skips the limits", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 8; i++) expect((await ask(store, { code: "me" })).ok).toBe(true);
  });

  it("brute-forcing codes gets rate limited", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 10; i++) await ask(store, { code: `guess${i}` });
    expect(await ask(store, { code: "guess-again" })).toMatchObject({ ok: false, status: 429 });
  });

  it("visitors with their own key only hit a per-IP limit", async () => {
    const store = new MemoryStore();
    expect(await ask(store, { ownKey: true })).toMatchObject({ ok: true, usage: "own-key" });
    expect((await ask(store, { ownKey: true })).ok).toBe(true);
    expect(await ask(store, { ownKey: true })).toMatchObject({ ok: false, status: 429 });
  });

  it("is open when no code is required (mock mode without codes)", async () => {
    expect(await ask(new MemoryStore(), {}, policy({ requireCode: false }))).toMatchObject({
      ok: true,
      usage: "open",
    });
  });
});
