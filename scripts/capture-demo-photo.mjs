// Renders the demo world from its original camera and ages it into a photograph.
// Requires `pnpm dev` running. Usage: node scripts/capture-demo-photo.mjs
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto("http://localhost:3000/dev/capture");
await page.waitForSelector('[data-loaded="true"]', { timeout: 120_000 });

const dataUrl = await page.evaluate(() => {
  const src = document.querySelector("canvas");
  const { width: w, height: h } = src;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");

  // Faded, warm, slightly soft: an old print of the same moment.
  ctx.filter = "sepia(0.38) saturate(0.72) contrast(0.9) brightness(1.03) blur(0.6px)";
  ctx.drawImage(src, 0, 0);
  ctx.filter = "none";

  // Lifted blacks.
  ctx.globalCompositeOperation = "lighten";
  ctx.fillStyle = "rgb(34, 28, 22)";
  ctx.fillRect(0, 0, w, h);

  // Warm light leak from one corner.
  ctx.globalCompositeOperation = "screen";
  const leak = ctx.createRadialGradient(w * 0.92, h * 0.08, 0, w * 0.92, h * 0.08, w * 0.7);
  leak.addColorStop(0, "rgba(255, 170, 90, 0.28)");
  leak.addColorStop(1, "rgba(255, 170, 90, 0)");
  ctx.fillStyle = leak;
  ctx.fillRect(0, 0, w, h);

  // Vignette.
  ctx.globalCompositeOperation = "multiply";
  const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
  vig.addColorStop(0, "rgba(255,255,255,1)");
  vig.addColorStop(1, "rgba(120,100,80,1)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // Grain.
  ctx.globalCompositeOperation = "overlay";
  const noise = ctx.createImageData(w, h);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 70;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
    noise.data[i + 3] = 60;
  }
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d").putImageData(noise, 0, 0);
  ctx.drawImage(tmp, 0, 0);

  return out.toDataURL("image/jpeg", 0.88);
});

await writeFile("public/demo/photo.jpg", Buffer.from(dataUrl.split(",")[1], "base64"));
await browser.close();
console.log("wrote public/demo/photo.jpg");
