import { expect, test } from "@playwright/test";

// Vault reveal auditing, and the REST API with a token created through the UI.

test("revealing a password shows it and writes an audit entry", async ({ page }) => {
  const run = Date.now();
  await page.goto("/vault/folders/new");
  await page.locator("#name").fill(`E2E folder ${run}`);
  await page.getByRole("button", { name: "Save folder" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`E2E folder ${run}`);

  await page.goto("/vault/new");
  await page.locator("#title").fill(`E2E switch admin ${run}`);
  await page.locator("#folderId").selectOption({ label: `E2E folder ${run}` });
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("S3cret-e2e-value");
  await page.getByRole("button", { name: "Save credential" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`E2E switch admin ${run}`);
  await expect(page.getByText("S3cret-e2e-value")).toHaveCount(0); // masked until revealed

  await page.getByRole("button", { name: "Reveal password" }).click();
  await expect(page.getByText("S3cret-e2e-value")).toBeVisible();

  await page.goto(`/audit?action=view_sensitive&q=E2E switch admin ${run}`);
  await expect(page.getByRole("main")).toContainText(`Revealed password of "E2E switch admin ${run}"`);
});

test("API token: created once in the UI, scoped, read-only, and revocable", async ({ page, playwright }) => {
  await page.goto("/profile");
  const form = page.locator("form", { hasText: "Create token" });
  await form.locator('input[name="name"]').fill(`E2E token ${Date.now()}`);
  await form.locator('input[value="assets"]').check();
  await form.getByRole("button", { name: "Create token" }).click();
  const token = (await page.locator("code", { hasText: "itd_" }).textContent())!.trim();
  expect(token).toMatch(/^itd_/);

  // A separate client with no cookies — only the bearer token
  const api = await playwright.request.newContext({ baseURL: page.url().replace(/\/profile.*$/, ""), extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const me = await api.get("/api/v1/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).access).toMatchObject({ assets: "read", network: "none" });
  expect(Number(me.headers()["x-ratelimit-remaining"])).toBeGreaterThan(0);
  const list = await api.get("/api/v1/assets?pageSize=5");
  expect((await list.json()).data.length).toBe(5);
  expect((await api.post("/api/v1/assets", { data: { name: "x" } })).status()).toBe(403); // read-only
  expect((await api.get("/api/v1/subnets")).status()).toBe(403); // out of scope

  // Revoke in the UI → the API refuses it
  await page.getByRole("button", { name: "Done" }).click();
  page.on("dialog", (d) => d.accept());
  await page.locator("tr", { hasText: token.slice(0, 10) }).getByRole("button", { name: "Revoke" }).click();
  await expect(page.locator("tr", { hasText: token.slice(0, 10) })).toContainText("revoked");
  expect((await api.get("/api/v1/me")).status()).toBe(401);
  await api.dispose();
});

test("the OpenAPI description is public", async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  const spec = await (await anon.get("/api/v1/openapi.json")).json();
  expect(spec.info.title).toBe("ITDocs API");
  expect((await anon.get("/api/v1/assets")).status()).toBe(401);
  await anon.dispose();
});
