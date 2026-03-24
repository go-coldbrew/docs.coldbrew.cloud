import { test, expect } from "@playwright/test";

test.describe("Search", () => {
  test("search input is visible", async ({ page }) => {
    await page.goto("/");
    const searchInput = page.locator("#search-input");
    await expect(searchInput).toBeVisible();
  });

  test("typing a query populates search results", async ({ page }) => {
    await page.goto("/");

    // Focus and type into search using pressSequentially to trigger JS key handlers
    const searchInput = page.locator("#search-input");
    await searchInput.click();
    await searchInput.pressSequentially("interceptor", { delay: 50 });

    // just-the-docs renders results as child elements inside #search-results
    const resultLink = page.locator("#search-results a, #search-results li, #search-results p");
    await expect(resultLink.first()).toBeAttached({ timeout: 10000 });
  });

  test("search results contain clickable links", async ({ page }) => {
    await page.goto("/");

    const searchInput = page.locator("#search-input");
    await searchInput.click();
    await searchInput.pressSequentially("tracing", { delay: 50 });

    // Wait for result links
    const resultLink = page.locator("#search-results a");
    await expect(resultLink.first()).toBeAttached({ timeout: 10000 });

    // Verify at least one link exists
    const count = await resultLink.count();
    expect(count).toBeGreaterThan(0);
  });
});
