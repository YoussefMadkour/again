import { expect, type Page, test } from "@playwright/test";

// Runs against its own AI_MODE=mock server with ACCESS_CODES="trial-once:1,open-sesame:*".
const PHOTO = "tests/fixtures/living-room-1946.jpg";

async function drop(page: Page) {
  await page.getByLabel("Choose a photograph").setInputFiles(PHOTO);
  await expect(page.getByTestId("access-panel")).toBeVisible();
}

async function enterCode(page: Page, code: string, share = false) {
  await page.getByLabel("Access code").fill(code);
  if (share) await page.getByLabel("add this memory to the public gallery").check();
  await page.getByRole("button", { name: "Enter" }).click();
}

test("an access code unlocks a memory, which can be shared to the gallery", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page.getByTestId("gallery-card")).toHaveCount(0);
  await drop(page);

  // The photo stays on screen while it waits for access.
  await expect(page.getByAltText(/photograph this memory/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /ask for a trial/ })).toHaveAttribute(
    "href",
    "https://x.com/messages/compose",
  );

  await enterCode(page, "not-a-code");
  await expect(page.getByText("that access code isn't valid")).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-state", "unlocking");

  await enterCode(page, "open-sesame", true);
  await expect(page.getByText(/finding the room|reconstructing space|listening/)).toBeVisible();
  const step = page.getByRole("button", { name: /step inside/i });
  await expect(step).toBeVisible({ timeout: 90_000 });
  await step.click();
  await expect(page.locator("main")).toHaveAttribute("data-state", "exploring", {
    timeout: 10_000,
  });

  // Back home, the shared memory is in the gallery, and opens for free.
  await page.getByRole("button", { name: "another memory" }).click();
  await expect(page.getByTestId("gallery-card")).toHaveCount(1, { timeout: 10_000 });
  await page.getByTestId("gallery-card").click();
  await expect(page).toHaveURL(/\?memory=[0-9a-f]{16}/);
  await expect(page.getByRole("button", { name: /step inside/i })).toBeVisible({
    timeout: 90_000,
  });
  expect(errors).toEqual([]);
});

test("a trial code works once, then asks for another way in", async ({ page }) => {
  await page.goto("/");
  await drop(page);
  await enterCode(page, "trial-once");
  await expect(page.locator("main")).toHaveAttribute("data-state", "generating");

  await page.getByRole("button", { name: "let go" }).click();
  await drop(page);
  await enterCode(page, "trial-once");
  await expect(page.getByText("this access code has been used up")).toBeVisible();

  // Their own World Labs key is the other way in.
  await page.getByRole("button", { name: "use your own world labs key" }).click();
  await page.getByLabel("World Labs API key").fill("wlt-visitors-own-key");
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-state", "generating");
});

test("unshared memories stay out of the gallery", async ({ page }) => {
  await page.goto("/");
  // Only the memory shared in the first test.
  await expect(page.getByTestId("gallery-card")).toHaveCount(1);
});

test("rejects files that aren't photos", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Choose a photograph").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByText(/jpg, png or webp/)).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-state", "idle");
});
