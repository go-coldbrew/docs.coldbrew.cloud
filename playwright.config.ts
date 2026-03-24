import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL || "http://localhost:4000";
const isLocal = baseURL.includes("localhost");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  ...(isLocal && {
    webServer: {
      command: "npx serve _site -l 4000",
      port: 4000,
      reuseExistingServer: !process.env.CI,
    },
  }),
});
