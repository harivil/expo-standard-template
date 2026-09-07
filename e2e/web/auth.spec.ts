import { expect, test } from "@playwright/test";

// What only web can break: deep links straight into a route, browser back, reload, and
// server rendering. The app renders every route in Node (`web.output: "static"`), so a
// module that throws at import time returns HTTP 500 rather than a blank screen — these
// assert a real response, not just that something painted.
//
// Elements are addressed by testID, which react-native-web renders as data-testid. The
// same prop addresses them from Maestro on native.

const PROTECTED_ROUTES = ["/", "/orders", "/schedule", "/labs", "/profile"];

test.describe("unauthenticated web app", () => {
  test("serves the login route without a server error", async ({ page }) => {
    const response = await page.goto("/login");

    // A 500 here means a module threw during server rendering — the failure mode that
    // an unset EXPO_PUBLIC_WORKOS_CLIENT_ID used to cause.
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("login-screen")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expect(page.getByText("Sign in to continue")).toBeVisible();
  });

  for (const route of PROTECTED_ROUTES) {
    test(`redirects ${route} to login when there is no session`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);

      // The auth guard lives in the root layout, so a deep link into a tab must land on
      // login rather than rendering a signed-in screen to a stranger.
      await expect(page.getByTestId("login-screen")).toBeVisible();
    });
  }

  test("survives a reload", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-screen")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("login-screen")).toBeVisible();
  });

  test("shows no error message before the user tries to sign in", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-screen")).toBeVisible();

    await expect(page.getByTestId("login-error")).toHaveCount(0);
  });

  test("renders the auth callback route rather than erroring", async ({ page }) => {
    // Reached as a cold start from the OAuth redirect. Without a code it must still
    // render, not 500 — it is the safety-net route.
    const response = await page.goto("/auth/callback");

    expect(response?.status()).toBe(200);
    await expect(page.getByText(/Finishing sign-in|Sign-in failed/)).toBeVisible();
  });
});
