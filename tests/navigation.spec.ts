import { test, expect } from "@playwright/test";

const topLevelPages = [
  { path: "/", title: "ColdBrew" },
  { path: "/getting-started/", title: "Getting Started" },
  { path: "/using/", title: "Using ColdBrew" },
  { path: "/architecture/", title: "Architecture" },
  { path: "/howto/", title: "How To" },
  { path: "/integrations/", title: "Integrations" },
  { path: "/faq/", title: "Frequently Asked Questions" },
  { path: "/packages/", title: "Packages" },
  { path: "/config-reference/", title: "Configuration Reference" },
];

const howtoPages = [
  "/howto/APIs/",
  "/howto/gRPC/",
  "/howto/Log/",
  "/howto/errors/",
  "/howto/Tracing/",
  "/howto/Metrics/",
  "/howto/interceptors/",
  "/howto/Debugging/",
  "/howto/signals/",
  "/howto/swagger/",
  "/howto/data-builder/",
  "/howto/vtproto/",
  "/howto/production/",
  "/howto/testing/",
];

test.describe("Page Loading", () => {
  for (const page of topLevelPages) {
    test(`top-level page loads: ${page.path}`, async ({ page: p }) => {
      const response = await p.goto(page.path);
      expect(response?.status()).toBe(200);
      await expect(p.locator("h1").first()).toContainText(page.title);
    });
  }

  for (const path of howtoPages) {
    test(`howto page loads: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1, h2").first()).toBeVisible();
    });
  }
});

test.describe("Navigation Sidebar", () => {
  test("sidebar contains top-level nav items", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator("nav.site-nav, .site-nav");
    await expect(nav).toBeVisible();

    // Check a subset that should always be present
    for (const link of ["Home", "How To", "Integrations"]) {
      await expect(
        nav.getByText(link, { exact: false }).first()
      ).toBeVisible();
    }
  });

  test("How To section has child pages in nav", async ({ page }) => {
    // Navigate to a howto child page so the nav section is expanded
    await page.goto("/howto/APIs/");
    const nav = page.locator("nav.site-nav, .site-nav");

    // These should be visible because the How To nav is expanded on a child page
    for (const child of ["gRPC", "Log", "Errors", "Tracing", "Metrics"]) {
      await expect(
        nav.getByText(child, { exact: false }).first()
      ).toBeVisible();
    }
  });
});

test.describe("Table of Contents", () => {
  const pagesWithToc = ["/faq/", "/integrations/"];

  for (const path of pagesWithToc) {
    test(`TOC renders on ${path}`, async ({ page }) => {
      await page.goto(path);
      // TOC generates internal anchor links
      const anchorLinks = page.locator('a[href^="#"]');
      expect(await anchorLinks.count()).toBeGreaterThan(0);
    });
  }
});

test.describe("Home Page CTAs", () => {
  test("Get Started button links to getting-started", async ({ page }) => {
    await page.goto("/");
    const mainContent = page.locator("#main-content, .main-content, main");
    const btn = mainContent.getByRole("link", { name: /Get Started/i });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("href", /getting-started/);
  });

  test("View Packages button links to packages", async ({ page }) => {
    await page.goto("/");
    const mainContent = page.locator("#main-content, .main-content, main");
    const btn = mainContent.getByRole("link", { name: /View Packages/i });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("href", /packages/);
  });

  test("How To button links to howto", async ({ page }) => {
    await page.goto("/");
    const mainContent = page.locator("#main-content, .main-content, main");
    const btn = mainContent.getByRole("link", { name: "How To" });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("href", /howto/);
  });

  test("GitHub button links to go-coldbrew org", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator('a.btn[href*="github.com/go-coldbrew"]');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("href", /github\.com\/go-coldbrew/);
  });
});

test.describe("Redirects", () => {
  test("/cookiecutter-reference redirects to /getting-started", async ({ page }) => {
    await page.goto("/cookiecutter-reference/");
    await page.waitForURL(/getting-started/);
    await expect(page).toHaveURL(/getting-started/);
  });
});
