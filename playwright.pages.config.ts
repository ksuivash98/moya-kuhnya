import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/pages",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4177",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command:
      "VITE_BASE_PATH=/moya-kuhnya/ npm run build:pages && node scripts/serve-pages-test.mjs",
    url: "http://127.0.0.1:4177/moya-kuhnya/",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
