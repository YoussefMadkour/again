import { expect, test } from "@playwright/test";

// Runs against AI_MODE=mock (the default): the "generated" world is the demo splat.
test("upload a photo → processing → memory ready → step inside", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page.getByText("drop a memory")).toBeVisible();

  await page.getByLabel("Choose a photograph").setInputFiles("tests/fixtures/living-room-1946.jpg");

  // The photograph stays on screen while the world is made.
  await expect(page.getByAltText(/photograph this memory/i)).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-state", "generating");
  await expect(page.getByText(/finding the room|reconstructing space|listening/)).toBeVisible();

  const step = page.getByRole("button", { name: /step inside/i });
  await expect(step).toBeVisible({ timeout: 90_000 });
  await step.click();
  await expect(page.locator("main")).toHaveAttribute("data-state", "exploring", {
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "another memory" }).click();
  await expect(page.getByText("drop a memory")).toBeVisible();
  expect(errors).toEqual([]);
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
