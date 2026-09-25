import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [OUT] = process.argv.slice(2);
const W = 1440,
  H = 900;
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--use-angle=metal", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
// Warm the cache (the 1946 world, the villa's first bytes) on a page we throw away.
const warm = await ctx.newPage();
await warm.goto("http://localhost:3000/");
await warm.waitForTimeout(2000);
await warm.getByRole("button", { name: /enter a memory/i }).click();
await warm.waitForSelector('[data-state="exploring"]', { timeout: 120000 });
await warm.waitForTimeout(3000);
const warmVideo = warm.video();
await warm.close();
await warmVideo?.delete();

const page = await ctx.newPage();
const t0 = Date.now();
const marks = [];
const mark = (name) => {
  marks.push({ name, t: (Date.now() - t0) / 1000 });
  console.log(name, marks.at(-1).t.toFixed(1));
};
const wait = (ms) => page.waitForTimeout(ms);
const glide = async (x0, y0, x1, y1, ms, drag = false) => {
  const steps = Math.max(10, Math.round(ms / 16));
  await page.mouse.move(x0, y0);
  if (drag) await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
    await wait(ms / steps);
  }
  if (drag) await page.mouse.up();
};
await page.goto("http://localhost:3000/");
await page.mouse.move(W / 2, H - 40);
await wait(2500);
mark("keep_start");
mark("vo:01-intro");
await wait(5000);
// Luna Park (last): arrow over, then drag its before/after handle.
for (let i = 0; i < 3; i++) {
  await page.keyboard.press("ArrowRight");
  await wait(450);
}
await wait(700);
mark("vo:02-luna");
const handle = page.getByRole("slider", { name: /Compare the original/ });
const hb = await handle.boundingBox();
const cx = hb.x + hb.width / 2,
  cy = hb.y + hb.height / 2;
await glide(cx, cy, cx - 170, cy, 1800, true);
await glide(cx - 170, cy, cx + 170, cy, 2600, true);
await glide(cx + 170, cy, cx, cy, 1600, true);
await wait(3000);
// Back to 1946, the way a visitor would: hover the visible edge of its photograph.
await page.evaluate(() => document.activeElement?.blur?.());
for (let step = 0; step < 4; step++) {
  const r = await page.getByRole("button", { name: /enter a memory/i }).boundingBox();
  if (!r) break;
  await glide(W / 2, H / 2, r.x + 12, r.y + r.height / 2, 700);
  await wait(900);
  const front = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /enter a memory/i.test(x.getAttribute("aria-label") || ""),
    );
    return b?.closest("li")?.style.zIndex === "100";
  });
  if (front) break;
}
await page.mouse.move(W / 2, H - 40);
await wait(600);
mark("vo:03-1946");
await wait(7600);
await page.getByRole("button", { name: /enter a memory/i }).click({ position: { x: 80, y: 80 } });
mark("cut_start");
await page.waitForSelector('[data-state="entering"]', { timeout: 120000 });
await wait(300);
mark("cut_end");
await wait(1700);
mark("vo:04-through");
await page.waitForSelector('[data-state="exploring"]', { timeout: 20000 });
await wait(1500);
mark("vo:05-room");
await glide(720, 450, 600, 455, 3500, true); // look left, gently (not past the photo)
await wait(600);
await glide(720, 450, 900, 448, 4200, true); // back round
await wait(600);
await glide(720, 450, 660, 450, 2400, true); // toward her
await wait(2500);
// The lamp: hover so it glows, click it, the evidence opens.
const beyond = page.getByRole("button", { name: /^continue$/i });
if (await beyond.isVisible().catch(() => false)) { await beyond.click(); await wait(800); }
mark("vo:06-lamp");
const lamp = await page.evaluate(() => {
  const m = [...document.querySelectorAll("button")].find((b) =>
    /table lamp/i.test(b.getAttribute("aria-label") || ""),
  );
  const r = m?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
if (lamp) {
  await glide(700, 600, lamp.x, lamp.y, 900);
  await wait(300);
  await page.mouse.click(lamp.x, lamp.y);
}
await wait(3600);
await page.keyboard.press("Escape");
await wait(1200);
mark("vo:07-space");
await page.keyboard.down("Space");
await wait(6400);
await page.keyboard.up("Space");
await wait(900);
mark("vo:08-marble");
await wait(600);
await page.keyboard.press("KeyM");
await wait(4600);
await page.keyboard.press("KeyM");
await wait(3200);
// Other rooms: the villa.
mark("vo:09-rooms");
await page.getByRole("button", { name: "another memory" }).click();
await wait(1800);
await page.keyboard.press("ArrowRight");
await wait(900);
await page
  .locator('[data-testid="gallery-card"]')
  .first()
  .click({ position: { x: 80, y: 80 } });
mark("cut_start");
await page.waitForSelector('[data-state="entering"]', { timeout: 180000 });
await wait(300);
mark("cut_end");
await page.waitForSelector('[data-state="exploring"]', { timeout: 30000 });
await wait(1200);
await glide(720, 450, 420, 455, 4000, true);
await wait(500);
await glide(720, 450, 1050, 450, 3500, true);
await wait(1500);
// Close: back to the photograph.
mark("vo:10-close");
await page.keyboard.press("Escape");
await wait(5200);
mark("keep_end");
const v = page.video();
await page.close();
const path = await v.path();
writeFileSync(OUT + "/marks.json", JSON.stringify({ path, marks }, null, 1));
await browser.close();
