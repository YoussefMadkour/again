import { expect, test } from "@playwright/test";

test("photo → step inside → world → look and move → return", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AGAIN." })).toBeVisible();
  await expect(page.getByAltText(/photograph this memory/i)).toBeVisible();

  const step = page.getByRole("button", { name: /step inside/i });
  await expect(step).toBeVisible({ timeout: 90_000 });
  await step.click();

  await expect(page.locator("main")).toHaveAttribute("data-state", "entering");
  await expect(page.locator("main")).toHaveAttribute("data-state", "exploring", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("explore-hud")).toBeVisible();

  const canvas = page.locator("canvas");
  const before = await canvas.screenshot();
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(400, 450, { steps: 15 });
  await page.mouse.up();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(600);
  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /return to photo/i }).isVisible();
  expect(errors).toEqual([]);
});
