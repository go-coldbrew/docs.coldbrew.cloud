import { test, expect, Page } from "@playwright/test";

/**
 * Collect all unique internal links from a page.
 */
async function getInternalLinks(
  page: Page,
  baseURL: string
): Promise<string[]> {
  const links = await page.locator("a[href]").evaluateAll(
    (els: HTMLAnchorElement[], base: string) =>
      els
        .map((el) => el.href)
        .filter(
          (href) =>
            href.startsWith(base) && !href.includes("#") && href !== base
        ),
    baseURL
  );
  return [...new Set(links)];
}

test.describe("Internal Links", () => {
  const pagesToCrawl = ["/", "/howto/APIs/", "/integrations/", "/packages/"];

  for (const pagePath of pagesToCrawl) {
    test(`all internal links on ${pagePath} resolve without errors`, async ({
      page,
      request,
    }) => {
      await page.goto(pagePath);
      const baseURL = new URL(page.url()).origin;
      const links = await getInternalLinks(page, baseURL);

      const broken: string[] = [];
      for (const link of links) {
        if (link === "#" || link.startsWith("javascript:")) continue;

        try {
          const response = await request.get(link);
          if (response.status() >= 400) {
            broken.push(`${link} => ${response.status()}`);
          }
        } catch {
          broken.push(`${link} => failed to fetch`);
        }
      }

      expect(
        broken,
        `Broken links on ${pagePath}:\n${broken.join("\n")}`
      ).toHaveLength(0);
    });
  }
});

test.describe("Anchor Links", () => {
  const pagesWithAnchors = [
    { path: "/integrations/", anchor: "prometheus" },
    { path: "/integrations/", anchor: "new-relic" },
    { path: "/integrations/", anchor: "sentry" },
  ];

  for (const { path, anchor } of pagesWithAnchors) {
    test(`anchor #${anchor} exists on ${path}`, async ({ page }) => {
      await page.goto(path);
      const element = page.locator(`[id="${anchor}"]`);
      await expect(element).toBeAttached();
    });
  }
});

test.describe("External Links (sample)", () => {
  test("pkg.go.dev links for core packages are reachable", async ({
    request,
  }) => {
    const pkgLinks = [
      "https://pkg.go.dev/github.com/go-coldbrew/core",
      "https://pkg.go.dev/github.com/go-coldbrew/errors",
      "https://pkg.go.dev/github.com/go-coldbrew/log",
    ];

    for (const url of pkgLinks) {
      const response = await request.get(url);
      expect(
        response.status(),
        `${url} returned ${response.status()}`
      ).toBeLessThan(400);
    }
  });

  test("GitHub repos are reachable", async ({ request }) => {
    const repos = [
      "https://github.com/go-coldbrew/core",
      "https://github.com/go-coldbrew/errors",
      "https://github.com/go-coldbrew/interceptors",
    ];

    for (const url of repos) {
      const response = await request.get(url);
      expect(
        response.status(),
        `${url} returned ${response.status()}`
      ).toBeLessThan(400);
    }
  });
});
