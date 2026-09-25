// Records the demo walkthrough (docs/DEMO_SCRIPT.md) against a running app on :3000. Every
// beat moves, and lasts at least as long as its voice line (durations from <vo_dir>/*.wav);
// loading waits are marked for cutting. Usage: node scripts/record-demo.mjs <out_dir> <vo_dir>
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
  await page.getByRole("button", { name: "another memory" }).click();
  await wait(1500);
};
const demo = page.getByRole("button", { name: /enter a memory/i });

await page.goto("http://localhost:3000/");
// No text selection from the drags (it paints the page blue).
await page.addStyleTag({ content: "* { user-select: none !important; -webkit-user-select: none !important; }" });
await page.mouse.move(W / 2, H - 30);
await wait(2500);
mark("keep_start");

await beat("01-what", async () => {
  const r = await demo.boundingBox();
  await glide(r.x + 40, r.y + r.height * 0.7, r.x + r.width - 40, r.y + r.height * 0.3, 6400);
});
await beat("02-home", async () => {
  for (const i of [1, 2, 3]) {
    await bringForward(i);
    await wait(500);
  }
});
await beat("03-slider", async () => {
  await bringForward(4);
  await page.mouse.move(W / 2, H - 30);
  await wait(500);
  const h = await page.getByRole("slider", { name: /Compare the original/ }).boundingBox();
  const cx = h.x + h.width / 2, cy = h.y + h.height / 2;
  await glide(cx, cy, cx - 160, cy, 1500, true);
  await glide(cx - 160, cy, cx + 160, cy, 2200, true);
  await glide(cx + 160, cy, cx, cy, 1300, true);
  await page.evaluate(() => document.activeElement?.blur?.());
});
await beat("04-open", async () => {
  await bringForward(0);
  const r = await demo.boundingBox();
  await glide(r.x + 60, r.y + r.height / 2, r.x + r.width / 2, r.y + r.height / 2, 3500);
  await wait(1600); // "…click the photo"
});
await page.mouse.move(W / 2, H - 30);
await demo.click({ position: { x: 70, y: 70 } });
mark("cut_start");
await page.waitForSelector('[data-state="entering"]', { timeout: 120000 });
await wait(250);
mark("cut_end");
await page.waitForSelector('[data-state="exploring"]', { timeout: 20000 });
await wait(400);

await beat("05-inside", async () => {
  await turn(-220, 1600);
  await walk("KeyW", 700);
  await turn(300, 1700);
});
// Keep turning left: past the photograph, the notice appears (once per visit).
await turn(-700, 2600);
for (let i = 0; i < 6 && !(await page.getByRole("button", { name: /^continue$/i }).isVisible().catch(() => false)); i++) await turn(-200, 600);
await beat("06-beyond", async () => { await wait(3800); });
await page.getByRole("button", { name: /^continue$/i }).click().catch(() => {});
await wait(600);
await beat("07-around", async () => {
  // The rest of the way round, to where we came in (facing her): read where the camera is.
  const target = await page.evaluate(() => window.__againLook?.target ?? 0);
  console.log("look before the rest of the turn", JSON.stringify(await page.evaluate(() => window.__againLook ?? null)));
  const TAU = Math.PI * 2;
  // turn(px) adds px × 0.0032 to the target yaw: carry on the same way to a whole turn.
  const goal = target < 0 ? Math.floor(target / TAU + 1e-3) * TAU : Math.ceil(target / TAU - 1e-3) * TAU;
  const px = (goal - target) / 0.0032;
  await turn(px, Math.max(3000, (Math.abs(px) / FULL) * 9000));
  await walk("KeyS", 500);
});
console.log("look after the turn", JSON.stringify(await page.evaluate(() => window.__againLook ?? null)));
await beat("08-her", async () => {
  await walk("KeyA", 600);
  await turn(160, 2400);
  await walk("KeyD", 700);
  await turn(-120, 1800);
});
await beat("09-lamp", async () => {
  const lamp = await page.evaluate(() => {
    const m = [...document.querySelectorAll("button")].find((b) => /table lamp/i.test(b.getAttribute("aria-label") || ""));
    const r = m?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (lamp) {
    await glide(W / 2, H * 0.7, lamp.x, lamp.y, 1200);
    await page.mouse.click(lamp.x, lamp.y);
  }
  await wait(3000);
  await page.keyboard.press("Escape");
  await wait(600);
});
await beat("10-space", async () => {
  await page.keyboard.down("Space");
  await turn(-260, 2600);
  await turn(260, 2600);
  await page.keyboard.up("Space");
});
await beat("11-dream", async () => {
  const s = await page.getByRole("slider", { name: /memory to dream/i }).boundingBox();
  const y = s.y + s.height / 2, x = s.x + s.width * 0.75;
  await glide(x, y, s.x + 4, y, 1300, true);
  await wait(500);
  await glide(s.x + 4, y, x, y, 1300, true);
});
await beat("12-m", async () => {
  await page.keyboard.press("KeyM");
  await turn(-200, 2400);
  await turn(200, 2000);
  await page.keyboard.press("KeyM");
  await wait(1200);
});
await home();
await openCard(1);
await beat("13-villa", async () => {
  await walk("KeyW", 600);
  await turn(-1963, 10000);
  await walk("KeyS", 500);
});
await home();
await openCard(3);
await beat("14-blue", async () => {
  await turn(-980, 5200);
  await walk("KeyW", 700);
  await turn(980, 5200);
});
await beat("15-end", async () => {
  await page.keyboard.press("Escape");
  await wait(3600);
});
mark("keep_end");
const v = page.video();
await page.close();
writeFileSync(`${OUT}/marks.json`, JSON.stringify({ path: await v.path(), marks }, null, 1));
await browser.close();
