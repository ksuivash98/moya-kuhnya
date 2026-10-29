import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: [
    {
      command: "npm run dev -- --port 4180 --strictPort",
      url: "http://127.0.0.1:4180",
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "https://recipe-tests.supabase.co",
        VITE_SUPABASE_ANON_KEY: "test-publishable-key",
      },
    },
    {
      command: "npm run dev -- --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        "npm run build && npm exec vite preview -- --host 127.0.0.1 --port 4176 --strictPort",
      url: "http://127.0.0.1:4176",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
  projects: [
    {
      name: "recipes-desktop",
      testMatch: ["**/recipes.spec.ts", "**/kitchen.spec.ts"],
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4180" },
    },
    {
      name: "recipes-mobile",
      testMatch: ["**/recipes.spec.ts", "**/kitchen.spec.ts"],
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        baseURL: "http://127.0.0.1:4180",
      },
    },
    {
      name: "desktop",
      testIgnore: [
        "**/pwa.spec.ts",
        "**/recipes.spec.ts",
        "**/kitchen.spec.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testIgnore: [
        "**/pwa.spec.ts",
        "**/recipes.spec.ts",
        "**/kitchen.spec.ts",
      ],
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    {
      name: "pwa",
      testMatch: "**/pwa.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4176" },
    },
  ],
});
