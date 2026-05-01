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

  test("auth howto renders code blocks", async ({ page }) => {
    await page.goto("/howto/auth/");
    const codeBlocks = page.locator("pre code");
    expect(await codeBlocks.count()).toBeGreaterThanOrEqual(5);
    const mainContent = page.locator("main, .main-content").first();
    await expect(mainContent).toContainText("JWT");
    await expect(mainContent).toContainText("API key");
  });

  test("workers howto renders middleware and jitter code blocks", async ({
    page,
  }) => {
    await page.goto("/howto/workers/");
    const codeBlocks = page.locator("pre code");
    expect(await codeBlocks.count()).toBeGreaterThanOrEqual(10);
    const mainContent = page.locator("main, .main-content").first();
    await expect(mainContent).toContainText("WithJitter");
    await expect(mainContent).toContainText("Middleware");
    await expect(mainContent).toContainText("CycleHandler");
    await expect(mainContent).toContainText("CycleFunc");
    await expect(mainContent).toContainText("DistributedLock");
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
    const pageText = await page.locator("main, .main-content").first().textContent();
    expect(pageText).toContain("gRPC status code");
  });

  test("integrations page renders content", async ({ page }) => {
    await page.goto("/integrations/");
    const pageText = await page.locator("main, .main-content").first().textContent();
    expect(pageText).toContain("Prometheus");
    expect(pageText).toContain("New Relic");
  });
});

test.describe("Images", () => {
  test("home page logo loads", async ({ page }) => {
    await page.goto("/");
    // just-the-docs may render the logo as an <img> tag or CSS background
    // depending on theme version — check for either
    const imgLogo = page.locator('img[src*="coldbrew"]');
    const cssLogo = page.locator('.site-logo, .site-title img');
    const hasLogo = (await imgLogo.count()) > 0 || (await cssLogo.count()) > 0;
    expect(hasLogo).toBe(true);
  });

  test("swagger image loads on swagger howto", async ({ page }) => {
    await page.goto("/howto/swagger/");
    const img = page.locator('img[src*="swagger"]');
    expect(await img.count()).toBeGreaterThan(0);
    await expect(img.first()).toBeVisible();
    const loaded = await img.first().evaluate((el: HTMLImageElement) => {
      return el.complete && el.naturalWidth > 0;
    });
    expect(loaded).toBe(true);
  });

  test("data-builder SVG loads on data-builder howto", async ({ page }) => {
    await page.goto("/howto/data-builder/");
    const img = page.locator('img[src*="data-builder"]');
    expect(await img.count()).toBeGreaterThan(0);
    await expect(img.first()).toBeVisible();
  });
});

test.describe("Callouts", () => {
  test("signals page has callout", async ({ page }) => {
    await page.goto("/howto/signals/");
    // just-the-docs renders callouts as blockquotes with specific classes
    const callout = page.locator("blockquote, .important, .warning, .note");
    expect(await callout.count()).toBeGreaterThan(0);
  });

  test("metrics page has legacy warning about hystrix", async ({ page }) => {
    await page.goto("/howto/Metrics/");
    const pageText = await page.locator("main, .main-content").first().textContent();
    expect(pageText).toContain("SetupHystrixPrometheus");
  });
});

test.describe("Readiness & Workers Integration", () => {
  test("readiness page renders all four patterns", async ({ page }) => {
    await page.goto("/howto/readiness/");
    const mainContent = page.locator("main, .main-content").first();
    await expect(mainContent).toContainText("Pattern 1");
    await expect(mainContent).toContainText("Pattern 2");
    await expect(mainContent).toContainText("Pattern 3");
    await expect(mainContent).toContainText("Pattern 4");
    await expect(mainContent).toContainText("CBPreStarter");
    await expect(mainContent).toContainText("CBWorkerProvider");
    const codeBlocks = page.locator("pre code");
    expect(await codeBlocks.count()).toBeGreaterThanOrEqual(4);
  });

  test("readiness page has choosing-a-pattern table", async ({ page }) => {
    await page.goto("/howto/readiness/");
    const tables = page.locator("table");
    expect(await tables.count()).toBeGreaterThanOrEqual(1);
  });

  test("workers page has ColdBrew Integration section", async ({ page }) => {
    await page.goto("/howto/workers/");
    const mainContent = page.locator("main, .main-content").first();
    await expect(mainContent).toContainText("ColdBrew Integration");
    await expect(mainContent).toContainText("CBWorkerProvider");
    await expect(mainContent).toContainText("Delegation pattern");
    await expect(mainContent).toContainText("Readiness Patterns");
  });
});

test.describe("Factual accuracy", () => {
  test("Tracing howto uses NewDatastoreSpan (not NewDatabaseSpan)", async ({ page }) => {
    await page.goto("/howto/Tracing/");
    const pageText = await page.locator("main, .main-content").first().textContent();
    expect(pageText).toContain("NewDatastoreSpan");
    expect(pageText).not.toContain("NewDatabaseSpan");
  });

  test("home page advertises correct local-stack counts", async ({ page }) => {
    await page.goto("/");
    const pageText = await page.locator("main, .main-content").first().textContent();
    expect(pageText).toContain("21 services");
    expect(pageText).toContain("18 single-service profiles");
  });

  test("local-dev page advertises correct local-stack counts", async ({ page }) => {
    await page.goto("/howto/local-dev/");
    const pageText = await page.locator("main, .main-content").first().textContent();
    expect(pageText).toContain("21 infrastructure services");
    expect(pageText).toContain("18 single-service profiles");
  });

  test("production page documents startup lifecycle hooks", async ({ page }) => {
    await page.goto("/howto/production/");
    const mainContent = page.locator("main, .main-content").first();
    await expect(mainContent).toContainText("Startup lifecycle");
    await expect(mainContent).toContainText("CBPreStarter");
    await expect(mainContent).toContainText("CBPostStarter");
  });
});

test.describe("SEO", () => {
  const pagesWithDescriptions = [
    "/",
    "/getting-started/",
    "/architecture/",
    "/config-reference/",
    "/howto/",
    "/integrations/",
    "/faq/",
    "/packages/",
    "/howto/APIs/",
    "/howto/workers/",
    "/howto/readiness/",
    "/howto/production/",
    "/howto/interceptors/",
    "/howto/auth/",
  ];

  for (const pagePath of pagesWithDescriptions) {
    test(`${pagePath} has meta description`, async ({ page }) => {
      await page.goto(pagePath);
      const meta = page.locator('meta[name="description"]');
      const content = await meta.getAttribute("content");
      expect(content, `${pagePath} missing meta description`).toBeTruthy();
      expect(
        content!.length,
        `${pagePath} description too short`
      ).toBeGreaterThan(20);
    });
  }
});

test.describe("Table of Contents", () => {
  const howtoPages = [
    "/howto/APIs/",
    "/howto/gRPC/",
    "/howto/Log/",
    "/howto/errors/",
    "/howto/Tracing/",
    "/howto/interceptors/",
    "/howto/workers/",
    "/howto/readiness/",
    "/howto/production/",
    "/howto/auth/",
  ];

  for (const pagePath of howtoPages) {
    test(`${pagePath} has table of contents`, async ({ page }) => {
      await page.goto(pagePath);
      const toc = page.locator("#table-of-contents, .no_toc, #toc");
      const hasTOC = (await toc.count()) > 0;
      // just-the-docs renders TOC as a list with anchor links
      const tocLinks = page.locator('nav[aria-label="Table of contents"] a, .no_toc + ol a, .no_toc + ul a');
      expect(
        hasTOC || (await tocLinks.count()) > 0,
        `${pagePath} missing table of contents`
      ).toBeTruthy();
    });
  }
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
