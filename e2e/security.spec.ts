import { expect, test } from "@playwright/test";

// Security headers, CSP enforcement in a real browser, and unauthenticated access.

test.describe("security headers and CSP", () => {
  test("pages send a nonce CSP and the browser reports no violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|Refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text());
    });
    for (const path of ["/dashboard", "/assets", "/kb", "/network", "/diagrams/map", "/reports", "/changes/journal", "/admin/integrations"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      const csp = res!.headers()["content-security-policy"];
      expect(csp, path).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res!.headers()["x-frame-options"]).toBe("DENY");
      expect(res!.headers()["x-content-type-options"]).toBe("nosniff");
      await expect(page.locator("main")).toBeVisible();
    }
    expect(violations).toEqual([]);
  });

  test("injected markup can't run inline script", async ({ page }) => {
    await page.goto("/dashboard");
    // Simulates markup that slipped into a page (e.g. a stored-XSS bug): an inline event handler.
    // page.evaluate itself runs with DevTools privileges, so the check is on what the *page* runs.
    const result = await page.evaluate(async () => {
      const w = window as unknown as { __pwned?: boolean };
      w.__pwned = false;
      const violations: string[] = [];
      document.addEventListener("securitypolicyviolation", (e) => violations.push(e.violatedDirective));
      const div = document.createElement("div");
      div.innerHTML = '<img src="data:," onerror="window.__pwned = true"><a id="x" href="javascript:window.__pwned=true">x</a>';
      document.body.appendChild(div);
      (document.getElementById("x") as HTMLAnchorElement).click();
      await new Promise((r) => setTimeout(r, 300));
      return { pwned: w.__pwned, violations };
    });
    expect(result.pwned).toBe(false);
    expect(result.violations.some((v) => v.startsWith("script-src"))).toBe(true);
  });

  test("knowledge-base Markdown can't inject script or markup", async ({ page }) => {
    await page.goto("/kb/new?template=blank");
    await page.locator("#title").fill(`XSS probe ${Date.now()}`);
    await page.locator("#body").fill('<img src=x onerror="window.__xss=1"> [click](javascript:alert(1))');
    await page.getByRole("tab", { name: "preview" }).click();
    const preview = page.locator(".md");
    await expect(preview).toContainText("<img src=x");
    expect(await preview.locator("img").count()).toBe(0);
    expect(await preview.locator('a[href^="javascript"]').count()).toBe(0);
  });
});

test.describe("unauthenticated access", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("pages redirect to sign-in and internal APIs return 401", async ({ page, request }) => {
    await page.goto("/vault");
    await expect(page).toHaveURL(/\/login\?next=%2Fvault$/);
    expect((await request.get("/api/search?q=ab")).status()).toBe(401);
    expect((await request.get("/api/files/anything")).status()).toBe(401);
    expect((await request.get("/api/assets/export")).status()).toBe(401);
    const health = await request.get("/api/health");
    expect(await health.json()).toEqual({ status: "ok" });
  });
});
