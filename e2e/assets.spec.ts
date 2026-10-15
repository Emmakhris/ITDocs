import { expect, test } from "@playwright/test";

// The core workflow: record a device, move it, and find its history.

test("create an asset, move it, and see the movement log and search", async ({ page }) => {
  const name = `E2E laptop ${Date.now()}`;
  await page.goto("/assets/new");
  await page.locator("#typeId").selectOption({ label: "Laptop" });
  await page.locator("#name").fill(name);
  await page.locator("#serial").fill(`E2E-${Date.now()}`);
  await page.getByRole("button", { name: "Create asset" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  const tag = (await page.getByRole("heading", { level: 1 }).locator(".font-mono").textContent())!.trim();
  expect(tag).toMatch(/^IT-\d{6}$/);

  await page.getByRole("button", { name: "Move / reassign" }).click();
  // The location tree indents option text with spaces, so pick the option by its text
  const ed = await page.locator("#toLocationId option", { hasText: "Emergency Dept" }).first().getAttribute("value");
  await page.locator("#toLocationId").selectOption(ed!);
  await page.locator("#toStatus").selectOption("DEPLOYED");
  await page.locator("#reason").fill("Deployed to ED triage desk");
  await page.getByRole("button", { name: "Record movement" }).click();

  await expect(page.locator("section", { hasText: "Movement history" }).first()).toContainText("Deployed to ED triage desk");
  await expect(page.locator("section", { hasText: "Current placement" }).first()).toContainText("Emergency Dept");

  // The movement is in the global movement log and the asset is findable by tag
  await page.goto(`/movements?q=${tag}`);
  await expect(page.getByRole("main")).toContainText("Deployed to ED triage desk");
  const hits = await page.request.get(`/api/search?q=${tag}`);
  expect((await hits.json()).some((h: { title: string }) => h.title.includes(tag))).toBe(true);
});

test("a reason is required to move an asset", async ({ page }) => {
  await page.goto("/assets?status=IN_STOCK");
  await page.locator("tbody a").first().click();
  await page.getByRole("button", { name: "Move / reassign" }).click();
  await page.locator("#toStatus").selectOption("IN_REPAIR");
  await page.getByRole("button", { name: "Record movement" }).click();
  await expect(page.getByText("A reason is required for the movement log")).toBeVisible();
});
