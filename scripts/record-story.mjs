// Records the one-minute story cut against a running app on :3000 (same helpers as
// record-demo.mjs): the 1946 room close to the photo's view, then the other rooms.
// Usage: node scripts/record-story.mjs <out_dir> <vo_dir>
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [OUT, VO] = process.argv.slice(2);
const W = 1440, H = 900;
const voLen = (name) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${VO}/${name}.wav`]).toString());

const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
// Warm the cache on a page we throw away.
const warm = await ctx.newPage();
await warm.goto("http://localhost:3000/"); await warm.waitForTimeout(2000);
await warm.getByRole("button", { name: /enter a memory/i }).click();
await warm.waitForSelector('[data-state="exploring"]', { timeout: 120000 });
await warm.waitForTimeout(2000);
const wv = warm.video(); await warm.close(); await wv?.delete();

const page = await ctx.newPage();
const t0 = Date.now();
const marks = [];
const now = () => (Date.now() - t0) / 1000;
const mark = (name) => { marks.push({ name, t: now() }); console.log(name, now().toFixed(1)); };
const wait = (ms) => page.waitForTimeout(ms);
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
async function glide(x0, y0, x1, y1, ms, drag = false) {
  const steps = Math.max(10, Math.round(ms / 20));
  await page.mouse.move(x0, y0);
  if (drag) await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const e = ease(i / steps);
    await page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
    await wait(ms / steps);
  }
  if (drag) await page.mouse.up();
}
/** Turn by `px` of drag (1,963 px is a full turn), in smooth strokes. */
let turned = 0;
const FULL = 1963;
async function turn(px, ms, pitch = 0) {
  turned += px;
  const strokes = Math.max(1, Math.ceil(Math.abs(px) / 480));
  for (let i = 0; i < strokes; i++) {
    const d = px / strokes;
    await glide(W / 2 + d / 2, H / 2, W / 2 - d / 2, H / 2 + pitch / strokes, ms / strokes, true);
  }
}
async function walk(key, ms) { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); }
/** A voice beat: marks it, runs its action, and holds until the line has finished. */
async function beat(name, action) {
  mark(`vo:${name}`);
  const start = now();
  await action();
  const left = voLen(name) + 0.6 - (now() - start);
  if (left > 0) await wait(left * 1000);
}
/** Which card is in front (its index in the carousel). */
const frontIndex = () =>
  page.evaluate(() => [...document.querySelectorAll('ul[aria-label="Memories"] > li')].findIndex((li) => li.style.zIndex === "100"));
/** Brings card `index` to the front: the pointer drifts toward it, the arrow keys turn it. */
async function bringForward(index) {
  await page.evaluate(() => document.activeElement?.blur?.());
  for (let i = 0; i < 8; i++) {
    const at = await frontIndex();
    if (at === index) return;
    await glide(W / 2, H / 2 + 150, W / 2 + (index > at ? 260 : -260), H / 2 + 150, 350);
    await page.keyboard.press(index > at ? "ArrowRight" : "ArrowLeft");
    await wait(750);
  }
}
async function openCard(index) {
  await bringForward(index);
  const locator = page.locator('ul[aria-label="Memories"] > li').nth(index).locator("button").last();
  await page.mouse.move(W / 2, H - 30);
  await wait(400);
  await locator.click({ position: { x: 70, y: 70 } });
  mark("cut_start");
  await page.waitForSelector('[data-state="entering"]', { timeout: 180000 });
  await wait(250);
  mark("cut_end");
  await page.waitForSelector('[data-state="exploring"]', { timeout: 30000 });
  await wait(600);
}
const home = async () => {
  // The "leaving the photographed memory" notice (once per visit) sits over the controls.
  const notice = page.getByRole("button", { name: /^continue$/i });
  if (await notice.isVisible().catch(() => false)) {
    await notice.click();
    await wait(500);
  }
  await page.getByRole("button", { name: "another memory" }).click();
  await wait(1500);
};
const demo = page.getByRole("button", { name: /enter a memory/i });

await page.goto("http://localhost:3000/");
await page.addStyleTag({ content: "* { user-select: none !important; -webkit-user-select: none !important; }" });
await page.mouse.move(W / 2, H - 30);
await wait(2500);
mark("keep_start");
await beat("a-photo", async () => {
  const r = await demo.boundingBox();
  await glide(r.x + 60, r.y + r.height * 0.65, r.x + r.width - 60, r.y + r.height * 0.4, 5200);
});
await page.mouse.move(W / 2, H - 30);
await demo.click({ position: { x: 70, y: 70 } });
mark("cut_start");
await page.waitForSelector('[data-state="entering"]', { timeout: 120000 });
await wait(250);
mark("cut_end");
await beat("b-click", async () => {
  await page.waitForSelector('[data-state="exploring"]', { timeout: 20000 });
  await wait(300);
});
// Inside the 1946 room, turns stay within the photograph's own view (±20°: 110 px ≈ 20°).
await beat("c-room", async () => {
  await turn(-110, 1700);
  await walk("KeyW", 800);
  await turn(170, 2000);
});
await beat("d-her", async () => {
  await turn(-90, 1800);
  await walk("KeyW", 450);
  await turn(20, 900);
});
await beat("e-space", async () => {
  await page.keyboard.down("Space");
  await turn(-60, 2600);
  await turn(60, 2600);
  await page.keyboard.up("Space");
});
await beat("f-any", async () => {
  await home();
});
await openCard(1);
await beat("g-villa", async () => {
  await walk("KeyW", 500);
  await turn(-1100, 6200);
});
await home();
await openCard(3);
await beat("h-blue", async () => {
  await turn(-950, 6000);
});
await home();
await beat("i-luna", async () => {
  await bringForward(4);
  await page.mouse.move(W / 2, H - 30);
  await wait(400);
  const h = await page.getByRole("slider", { name: /Compare the original/ }).boundingBox();
  const cx = h.x + h.width / 2, cy = h.y + h.height / 2;
  await glide(cx, cy, cx - 150, cy, 1400, true);
  await glide(cx - 150, cy, cx + 150, cy, 2000, true);
  await glide(cx + 150, cy, cx, cy, 1200, true);
  await page.evaluate(() => document.activeElement?.blur?.());
});
await beat("j-end", async () => {
  await glide(W / 2, H - 30, W / 2 + 120, H - 60, 2200);
});
mark("keep_end");
const v = page.video();
await page.close();
writeFileSync(`${OUT}/marks.json`, JSON.stringify({ path: await v.path(), marks }, null, 1));
await browser.close();
