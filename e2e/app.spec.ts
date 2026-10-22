import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fixturesFile } from "./fixtures.mjs";

type User = { id: string; email: string; name: string };
const fixtures = (): { password: string; users: Record<"admin" | "alice" | "bob", User>; workspaceId: string; roomId: string } =>
  JSON.parse(readFileSync(fixturesFile, "utf8"));

async function signIn(page: Page, user: User) {
  await page.goto("/login");
  await page.getByLabel("Email tài khoản").fill(user.email);
  await page.locator('input[type="password"]:visible').fill(fixtures().password);
  await page.locator('form:visible button[type="submit"]').first().click();
  await page.waitForURL(/\/app\//);
}

type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions = new Map<string, Session>();
const open: { userId: string; context: BrowserContext }[] = [];
/**
 * Signs in once per user and reuses the session, so the run stays under the login rate limit.
 * Refresh tokens rotate, so the state is saved again when the test ends.
 */
async function signedIn(browser: Browser, user: User) {
  const context = await browser.newContext({ storageState: sessions.get(user.id) });
  open.push({ userId: user.id, context });
  const page = await context.newPage();
  if (sessions.has(user.id)) await page.goto("/app/overview");
  else await signIn(page, user);
  return page;
}
test.afterEach(async () => {
  for (const { userId, context } of open.splice(0)) {
    sessions.set(userId, await context.storageState());
    await context.close();
  }
});

/** Video elements actually decoding frames: the local preview plus every remote participant. */
const playingVideos = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll("video")].filter((video) => video.readyState >= 2 && video.videoWidth > 0).length);

test("đăng nhập sai mật khẩu báo lỗi, đúng mật khẩu vào trang chủ", async ({ page }) => {
  const { users } = fixtures();
  await page.goto("/login");
  await page.getByLabel("Email tài khoản").fill(users.alice.email);
  await page.locator('input[type="password"]:visible').fill("sai-mat-khau-123");
  await page.locator('form:visible button[type="submit"]').first().click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, users.alice);
  await expect(page.getByText(`Xin chào, ${users.alice.name}`)).toBeVisible();
});

test("chỉ quản trị hệ thống thấy trang Quản trị và sức khoẻ hệ thống", async ({ browser }) => {
  const { users } = fixtures();
  const member = await signedIn(browser, users.alice);
  await expect(member.getByText("Trang chủ").first()).toBeVisible();
  await expect(member.getByRole("button", { name: "Quản trị hệ thống" })).toHaveCount(0);

  const admin = await signedIn(browser, users.admin);
  await expect(admin.getByRole("button", { name: "Quản trị hệ thống" })).toBeVisible();
  await admin.goto("/app/access");
  await expect(admin.getByRole("heading", { name: "Sức khoẻ hệ thống" })).toBeVisible();
  await expect(admin.locator(".admin-health-card")).toHaveCount(5);
  await expect(admin.getByRole("heading", { name: "Khoa & giảng viên" })).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Phân quyền" })).toBeVisible();
});

test("hai người vào cùng phòng họp thấy video của nhau và tự vào lại sau khi mất mạng", async ({ browser }) => {
  const { users, workspaceId, roomId } = fixtures();
  const room = `/app/meetings?workspace=${workspaceId}&channel=${roomId}`;
  const [alice, bob] = [await signedIn(browser, users.alice), await signedIn(browser, users.bob)];
  for (const page of [alice, bob]) {
    await page.goto(room);
    await page.locator(".meeting-lobby-action").getByRole("button", { name: /^Tham gia / }).click();
  }
  // Each side: own camera + the other's.
  await expect.poll(() => playingVideos(alice), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => playingVideos(bob), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  await bob.context().setOffline(true);
  await expect(bob.getByText("Mất kết nối cuộc họp")).toBeVisible({ timeout: 45_000 });
  await bob.context().setOffline(false);
  await expect(bob.getByText("Đã vào cuộc họp").last()).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => playingVideos(alice), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
});

test("trang Khóa học và Tổng đài mở được", async ({ browser }) => {
  const page = await signedIn(browser, fixtures().users.alice);
  await page.goto("/app/elearning");
  await expect(page.locator("main")).toContainText(/Khóa học/);
  await page.goto("/app/call-directory");
  await expect(page.locator("main")).not.toBeEmpty();
});
