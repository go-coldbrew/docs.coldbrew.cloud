import { test, expect } from "@playwright/test";

test.describe("Code Blocks", () => {
  test("home page renders code blocks", async ({ page }) => {
    await page.goto("/");
    const codeBlocks = page.locator("pre code");
    expect(await codeBlocks.count()).toBeGreaterThan(0);
  });

  test("APIs howto renders proto and Go code blocks", async ({ page }) => {
    await page.goto("/howto/APIs/");
    const codeBlocks = page.locator("pre code");
    expect(await codeBlocks.count()).toBeGreaterThanOrEqual(5);
  });

  test("gRPC howto renders code blocks", async ({ page }) => {
    await page.goto("/howto/gRPC/");
    const codeBlocks = page.locator("pre code");
    expect(await codeBlocks.count()).toBeGreaterThanOrEqual(2);
  });
});

test.describe("Tables", () => {
  test("home page has feature table", async ({ page }) => {
    await page.goto("/");
    const tables = page.locator("table");
    expect(await tables.count()).toBeGreaterThanOrEqual(2);
  });

  test("APIs page has gRPC status code mapping table", async ({ page }) => {
    await page.goto("/howto/APIs/");
    const tables = page.locator("table");
    expect(await tables.count()).toBeGreaterThanOrEqual(1);
    // Check that the status code table exists
    const pageText = await page.locator("main, .main-content").textContent();
    expect(pageText).toContain("gRPC status code");
  });

  test("integrations page renders content", async ({ page }) => {
    await page.goto("/integrations/");
    const pageText = await page.locator("main, .main-content").textContent();
    expect(pageText).toContain("Prometheus");
    expect(pageText).toContain("New Relic");
  });
});

test.describe("Images", () => {
  test("home page logo loads", async ({ page }) => {
    await page.goto("/");
    const logo = page.locator('img[src*="coldbrew"]');
    if ((await logo.count()) > 0) {
      await expect(logo.first()).toBeVisible();
    }
  });

  test("swagger image loads on swagger howto", async ({ page }) => {
    await page.goto("/howto/swagger/");
    const img = page.locator('img[src*="swagger"]');
    if ((await img.count()) > 0) {
      await expect(img.first()).toBeVisible();
      const loaded = await img.first().evaluate((el: HTMLImageElement) => {
        return el.complete && el.naturalWidth > 0;
      });
      expect(loaded).toBe(true);
    }
  });

  test("data-builder SVG loads on data-builder howto", async ({ page }) => {
    await page.goto("/howto/data-builder/");
    const img = page.locator('img[src*="data-builder"]');
    if ((await img.count()) > 0) {
      await expect(img.first()).toBeVisible();
    }
  });
});

test.describe("Callouts", () => {
  test("signals page has callout", async ({ page }) => {
    await page.goto("/howto/signals/");
    // just-the-docs renders callouts as blockquotes with specific classes
    const callout = page.locator("blockquote, .important, .warning, .note");
    expect(await callout.count()).toBeGreaterThan(0);
  });

  test("metrics page has warning about hystrix", async ({ page }) => {
    await page.goto("/howto/Metrics/");
    const pageText = await page.locator("main, .main-content").textContent();
    expect(pageText).toContain("unmaintained");
  });
});

test.describe("ASCII Diagrams", () => {
  test("home page renders architecture diagram in pre block", async ({
    page,
  }) => {
    await page.goto("/");
    const pre = page.locator("pre");
    const preTexts = await pre.allTextContents();
    const hasDiagram = preTexts.some(
      (text) =>
        text.includes("ColdBrew Core") || text.includes("Interceptor Chain")
    );
    expect(hasDiagram).toBe(true);
  });
});
