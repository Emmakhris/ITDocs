import { expect, test as setup } from "@playwright/test";
import { E2E } from "../playwright.config";

// Signs in once as the e2e admin; the other specs reuse the saved session.
setup("sign in as admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(E2E.admin.username);
  await page.getByLabel("Password").fill(E2E.admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
});
