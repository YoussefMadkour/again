import { expect, test } from "@playwright/test";

test("demo memory → step inside → world → look and move → return", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AGAIN." })).toBeVisible();
  await page.getByRole("button", { name: /enter a memory/i }).click();
  await expect(page.getByAltText(/photograph this memory/i)).toBeVisible();

  const step = page.getByRole("button", { name: /step inside/i });
  await expect(step).toBeVisible({ timeout: 90_000 });
  await step.click();

  await expect(page.locator("main")).toHaveAttribute("data-state", "entering");
  await expect(page.locator("main")).toHaveAttribute("data-state", "exploring", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("explore-hud")).toBeVisible();

  // The photo's own pixels on the walls, or the world model's: a button, and P.
  const layersButton = page.getByRole("button", { name: /photo layers/ });
  await expect(layersButton).toHaveText("photo layers on");
  await layersButton.click();
  await expect(layersButton).toHaveText("photo layers off");
  await page.keyboard.press("KeyP");
  await expect(layersButton).toHaveText("photo layers on");

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

test("a hero object shows where it came from in the photograph", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /enter a memory/i }).click();
  const step = page.getByRole("button", { name: /^step inside$/i });
  await expect(step).toBeVisible({ timeout: 90_000 });
  await step.click();
  await expect(page.locator("main")).toHaveAttribute("data-state", "exploring", {
    timeout: 10_000,
  });
  await expect(page.getByText(/click what glows/)).toBeVisible();
  await expect(page.getByRole("button", { name: "sound on" })).toBeVisible();

  // The demo's table lamp sits at about (755, 575) at 1440x900 right after entering.
  await page.waitForTimeout(2500);
  await page.mouse.move(755, 575, { steps: 4 });
  await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe("pointer");
  await page.mouse.click(755, 575);
  await expect(page.getByTestId("evidence")).toBeVisible();
  await expect(page.getByText("observed here")).toBeVisible();
  await expect(page.getByTestId("evidence").getByText("table lamp")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("evidence")).toBeHidden();
  await expect(page.locator("main")).toHaveAttribute("data-state", "exploring");

  // Each object has a marker; clicking it also opens the evidence, then it quiets down.
  const marker = page.getByRole("button", { name: /treadle sewing machine table: see where/ });
  await expect(marker).toBeVisible();
  await expect(marker).not.toHaveClass(/is-seen/);
  await marker.click();
  await expect(page.getByTestId("evidence")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(marker).toHaveClass(/is-seen/);
});

test("memory ↔ dream, what the photo saw, and leaving the photographed memory", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /enter a memory/i }).click();
  const step = page.getByRole("button", { name: /^step inside$/i });
  await expect(step).toBeVisible({ timeout: 90_000 });
  await step.click();
  await expect(page.locator("main")).toHaveAttribute("data-state", "exploring", {
    timeout: 10_000,
  });

  const slider = page.getByLabel("Memory to dream");
  await expect(slider).toBeVisible();
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(slider).toHaveValue("0");
  await page.getByRole("button", { name: "Dream", exact: true }).click();
  await expect(slider).toHaveValue("1");

  // Hold SPACE: observed / inferred / imagined.
  await page.locator("canvas").click({ position: { x: 20, y: 20 } });
  await page.keyboard.down("Space");
  await expect(page.getByTestId("provenance-legend")).toBeVisible();
  await expect(page.getByText("imagined", { exact: true })).toBeVisible();
  await page.keyboard.up("Space");
  await expect(page.getByTestId("provenance-legend")).toBeHidden();

  // Turn well away from what the photograph saw.
  await page.mouse.move(1000, 450);
  await page.mouse.down();
  await page.mouse.move(400, 450, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByTestId("beyond")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("You are leaving the photographed memory.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("beyond")).toBeHidden();

  // Only once per session.
  await page.mouse.move(400, 450);
  await page.mouse.down();
  await page.mouse.move(1000, 450, { steps: 10 });
  await page.mouse.move(300, 450, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("beyond")).toBeHidden();
});
