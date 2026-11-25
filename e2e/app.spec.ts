import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fixturesFile } from "./fixtures.mjs";

type User = { id: string; email: string; name: string };
const fixtures = (): {
  password: string;
  users: Record<"admin" | "alice" | "bob" | "carol", User>;
  workspaceId: string;
  roomId: string;
} => JSON.parse(readFileSync(fixturesFile, "utf8"));

async function signIn(page: Page, user: User) {
  await page.goto("/login");
  // The login screen first tries to restore a session; filling before it settles loses the input.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email hoặc mã số SV / GV").fill(user.email);
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
  if (sessions.has(user.id)) {
    await page.goto("/app/overview");
    // A refresh that rotated the token after the state was saved (e.g. a call rejoining as the test ended) ends the session.
    await page
      .locator('nav[aria-label="Menu chức năng chính"], input[type="password"]:visible')
      .first()
      .waitFor();
    if (!(await page.getByRole("navigation", { name: "Menu chức năng chính" }).count()))
      await signIn(page, user);
  } else await signIn(page, user);
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
  page.evaluate(
    () =>
      [...document.querySelectorAll("video")].filter(
        (video) => video.readyState >= 2 && video.videoWidth > 0,
      ).length,
  );

test("đăng nhập sai mật khẩu báo lỗi, đúng mật khẩu vào trang chủ", async ({ page }) => {
  const { users } = fixtures();
  await page.goto("/login");
  await page.getByLabel("Email hoặc mã số SV / GV").fill(users.alice.email);
  await page.locator('input[type="password"]:visible').fill("sai-mat-khau-123");
  await page.locator('form:visible button[type="submit"]').first().click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, users.alice);
  await expect(page.getByRole("button", { name: `Tài khoản: ${users.alice.name}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bảng tin nội bộ" })).toBeVisible();
});

test("chỉ quản trị hệ thống thấy trang Quản trị và sức khoẻ hệ thống", async ({ browser }) => {
  const { users } = fixtures();
  const member = await signedIn(browser, users.alice);
  await expect(member.getByText("Trang chủ").first()).toBeVisible();
  // Alice owns a group, so "Quản lý" holds her board link, never the system admin page.
  await expect(member.getByRole("link", { name: "Quản trị hệ thống" })).toHaveCount(0);

  // Administration lives in the "Quản lý" group of the sidebar.
  const admin = await signedIn(browser, users.admin);
  await admin
    .getByRole("group", { name: "Quản lý" })
    .getByRole("link", { name: "Quản trị hệ thống" })
    .click();
  await expect(admin).toHaveURL(/\/app\/access/);
  const tabs = admin.getByRole("tablist", { name: "Phân hệ quản trị" });
  await expect(admin.getByRole("navigation", { name: "Đơn vị" })).toBeVisible();
  await tabs.getByRole("tab", { name: "Phân quyền" }).click();
  await expect(admin.getByRole("region", { name: "Phân quyền" })).toBeVisible();
  await tabs.getByRole("tab", { name: "Sức khỏe hệ thống" }).click();
  await expect(
    admin.getByRole("region", { name: "Sức khỏe hệ thống" }).getByRole("article"),
  ).toHaveCount(5);
});

test("hai người vào cùng phòng họp thấy video của nhau và tự vào lại sau khi mất mạng", async ({
  browser,
}) => {
  // Losing the network is only noticed after the ICE/socket timeouts (up to 45 s), then the rejoin.
  test.setTimeout(150_000);
  const { users, workspaceId, roomId } = fixtures();
  const room = `/app/meetings?workspace=${workspaceId}&channel=${roomId}`;
  const [alice, bob] = [await signedIn(browser, users.alice), await signedIn(browser, users.bob)];
  for (const page of [alice, bob]) {
    await page.goto(room);
    await page.getByRole("button", { name: "Vào phòng" }).click();
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

test("menu theo chức năng", async ({ browser }) => {
  const page = await signedIn(browser, fixtures().users.alice);
  const menu = page.getByRole("navigation", { name: "Menu chức năng chính" });
  // A menu link's name ends with its unread badge, if any.
  const item = (name: string) => menu.getByRole("link", { name: new RegExp(`^${name}( \\d+)?$`) });
  for (const name of [
    "Trang chủ",
    "Tổng đài",
    "Tin nhắn",
    "Họp",
    "Khóa học",
    "Thông báo",
    "Nhân sự",
  ])
    await expect(item(name).first()).toBeVisible();
  // Alice owns a group and may post to its board, so "Quản lý bảng tin" is hers too.
  for (const name of ["Quản trị hệ thống", "Báo cáo đơn vị"])
    await expect(item(name)).toHaveCount(0);
});

test("tài khoản chưa có nhóm thấy hướng dẫn tạo nhóm", async ({ browser }) => {
  const page = await signedIn(browser, fixtures().users.carol);
  await page.goto("/app/chat");
  await expect(
    page.locator("main").getByRole("button", { name: "Tạo nhóm" }).first(),
  ).toBeVisible();
  await page.goto("/app/meetings");
  await expect(
    page.locator("main").getByRole("button", { name: "Tạo nhóm" }).first(),
  ).toBeVisible();
});

test("Tin nhắn liệt kê nhóm như một đoạn chat và gửi được tin", async ({ browser }) => {
  const { users, workspaceId } = fixtures();
  const page = await signedIn(browser, users.alice);
  await page.goto("/app/chat");
  const nav = page.getByRole("navigation", { name: "Hội thoại" });
  await expect(nav.getByRole("button", { name: /E2E \d+/ })).toBeVisible();
  await expect(nav.getByText("#Tổng quan")).toHaveCount(0);
  await nav.getByRole("button", { name: /E2E \d+/ }).click();
  const text = `xin chào e2e ${Date.now()}`;
  await page.locator("#chat-message").fill(text);
  await page.locator("#chat-message").press("Enter");
  await expect(page.locator("[data-message-text]").getByText(text)).toBeVisible();
  // An old group link lands on the same page, in that group's channel.
  await page.goto(`/app/workspace?workspace=${workspaceId}`);
  await expect(page).toHaveURL(/\/app\/chat\?workspace=/);
  await expect(page.locator("[data-message-text]").getByText(text)).toBeVisible();
});

test("Họp: lên lịch rồi thấy trên lịch tuần, vào được phòng", async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await signedIn(browser, fixtures().users.alice);
  await page.goto("/app/meetings");
  await page.getByRole("button", { name: "Lên lịch", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const group =
    (await dialog
      .getByLabel("Nhóm")
      .locator("option")
      .filter({ hasText: /^E2E \d+$/ })
      .first()
      .textContent()) ?? "";
  await dialog.getByLabel("Nhóm").selectOption({ label: group });
  const title = `Họp e2e ${Date.now()}`;
  await dialog.getByLabel("Tên cuộc họp").fill(title);
  await dialog.getByRole("button", { name: "Tạo lịch họp" }).click();
  await expect(dialog).toHaveCount(0);
  // The list shows it (created an hour from now); its detail pane has "Vào phòng họp",
  // which opens the device check.
  const row = page.locator("[data-meeting-row]").filter({ hasText: title });
  const enter = async () => {
    await row.click();
    await page.getByRole("button", { name: "Vào phòng họp", exact: true }).click();
    await page.locator("main").getByRole("button", { name: "Vào phòng" }).last().click();
    await expect.poll(() => playingVideos(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  };
  await enter();
  // Leaving goes back to the agenda, not to the room's device check.
  await page.getByRole("button", { name: "Rời khỏi phòng họp" }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Rời phòng" });
  if (
    await confirm.waitFor({ timeout: 3_000 }).then(
      () => true,
      () => false,
    )
  )
    await confirm.click();
  await expect(row).toBeVisible();
  await enter();
  // The room covers the app; "Thu nhỏ" goes back to the app with the call still running,
  // and the "Họp" item brings the room back.
  await page.getByRole("button", { name: "Thu nhỏ cuộc họp" }).click();
  await page
    .getByRole("navigation", { name: "Menu chức năng chính" })
    .getByRole("link", { name: /^Họp( |$)/ })
    .click();
  await expect.poll(() => playingVideos(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await expect(row).toHaveCount(0);
});
