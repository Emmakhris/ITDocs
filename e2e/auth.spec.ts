import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

test.use({ storageState: { cookies: [], origins: [] } });

// Next.js adds an empty role="alert" route announcer; the form's alert is the one with text
const formAlert = (page: import("@playwright/test").Page) => page.getByRole("alert").filter({ hasText: /\w/ });

async function signIn(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("wrong password is refused with a generic message", async ({ page }) => {
  await signIn(page, E2E.admin.username, "definitely-wrong");
  await expect(formAlert(page)).toContainText("Invalid username or password");
  await expect(page).toHaveURL(/\/login/);
});

test("five failures lock the account for this address, and the lockout is audited", async ({ page, browser }) => {
  const user = `nobody-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    await signIn(page, user, `wrong-${i}`);
    await expect(formAlert(page)).toBeVisible();
  }
  await signIn(page, user, "anything");
  await expect(formAlert(page)).toContainText("Too many failed attempts");

  // An admin can see the lockout in the audit log
  const admin = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  const p = await admin.newPage();
  await p.goto(`/audit?action=login_locked&q=${user}`);
  await expect(p.getByRole("main")).toContainText(`"${user}" locked out`);
  await admin.close();
});

test("signing in, remembering where you were going, and signing out", async ({ page }) => {
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/login\?next=%2Freports/);
  await page.getByLabel("Username").fill(E2E.admin.username);
  await page.getByLabel("Password").fill(E2E.admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
