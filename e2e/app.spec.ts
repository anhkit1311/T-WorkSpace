import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fixturesFile } from "./fixtures.mjs";

type User = { id: string; email: string; name: string };
const fixtures = (): { password: string; users: Record<"admin" | "alice" | "bob" | "carol", User>; workspaceId: string; roomId: string } =>
  JSON.parse(readFileSync(fixturesFile, "utf8"));

async function signIn(page: Page, user: User) {
  await page.goto("/login");
  // The login screen first tries to restore a session; filling before it settles loses the input.
  await page.waitForLoadState("networkidle");
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
  if (sessions.has(user.id)) {
    await page.goto("/app/overview");
    // A refresh that rotated the token after the state was saved (e.g. a call rejoining as the test ended) ends the session.
    await page.locator('.app-shell, input[type="password"]:visible').first().waitFor();
    if (!(await page.locator(".app-shell").count())) await signIn(page, user);
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
  const menu = page.locator(".tdtu-sidebar");
  // A menu button's name ends with its unread badge, if any.
  const item = (name: string) => menu.getByRole("button", { name: new RegExp(`^${name}( \\d+)?$`) });
  for (const name of ["Tin nhắn", "Họp", "Công việc", "Tài liệu", "Nhóm của tôi"]) await expect(item(name)).toBeVisible();
  for (const name of ["Nhóm làm việc", "Quản trị nhóm"]) await expect(item(name)).toHaveCount(0);
  await item("Nhóm của tôi").click();
  const group = page.locator("main").getByRole("listitem").filter({ hasText: /^E2E \d+/ });
  await expect(group).toBeVisible();
  await expect(group.getByRole("button", { name: "Quản lý" })).toBeVisible();
});

test("tài khoản chưa có nhóm thấy hướng dẫn tạo nhóm", async ({ browser }) => {
  const page = await signedIn(browser, fixtures().users.carol);
  await page.goto("/app/groups");
  await expect(page.locator("main").getByRole("button", { name: "Tạo nhóm" }).first()).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: "Nhập mã mời" }).first()).toBeVisible();
  await page.goto("/app/chat");
  await expect(page.locator("main").getByRole("button", { name: "Tạo nhóm" }).first()).toBeVisible();
  await page.goto("/app/tasks");
  await expect(page.locator("main").getByRole("button", { name: "Tạo nhóm" }).first()).toBeVisible();  await page.goto("/app/files");
  await expect(page.locator("main").getByRole("button", { name: "Tạo nhóm" }).first()).toBeVisible();  await page.goto("/app/meetings");
  await expect(page.locator("main").getByRole("button", { name: "Tạo nhóm" }).first()).toBeVisible();
});

test("Tin nhắn liệt kê kênh của nhóm và gửi được tin", async ({ browser }) => {
  const { users, workspaceId } = fixtures();
  const page = await signedIn(browser, users.alice);
  await page.goto("/app/chat");
  const nav = page.getByRole("navigation", { name: "Hội thoại" });
  await expect(nav.getByText(/^E2E \d+$/)).toBeVisible();
  await expect(nav.getByRole("button", { name: /#tong-quan/ })).toBeVisible();
  await nav.getByRole("button", { name: /#tong-quan/ }).click();
  const text = `xin chào e2e ${Date.now()}`;
  await page.locator("#chat-message").fill(text);
  await page.locator("#chat-message").press("Enter");
  await expect(page.locator(".message-row__text").getByText(text)).toBeVisible();
  // An old group link lands on the same page, in that group's channel.
  await page.goto(`/app/workspace?workspace=${workspaceId}`);
  await expect(page).toHaveURL(/\/app\/chat\?workspace=/);
  await expect(page.locator(".message-row__text").getByText(text)).toBeVisible();
});

test("Công việc: tạo việc ở nhóm và thấy trên bảng của tôi", async ({ browser }) => {
  const page = await signedIn(browser, fixtures().users.alice);
  await page.goto("/app/tasks");
  await page.getByRole("button", { name: "Việc mới" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nhóm").selectOption({ label: (await dialog.getByLabel("Nhóm").locator("option").filter({ hasText: /^E2E \d+$/ }).first().textContent()) ?? "" });
  const title = `Viết biên bản e2e ${Date.now()}`;
  await dialog.getByLabel("Tên việc").fill(title);
  await expect(dialog.getByLabel("Giao cho tôi")).toBeChecked();
  await dialog.getByRole("button", { name: "Tạo việc" }).click();
  const card = page.getByRole("region", { name: "Cần làm" }).locator("article").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText(/^E2E \d+$/)).toBeVisible();
});

test("Tài liệu: tải tệp lên nhóm rồi tìm thấy", async ({ browser }) => {
  const page = await signedIn(browser, fixtures().users.alice);
  await page.goto("/app/files");
  await page.getByRole("button", { name: "Tải lên" }).click();
  const dialog = page.getByRole("dialog");
  const group = (await dialog.getByLabel("Nhóm").locator("option").filter({ hasText: /^E2E \d+$/ }).first().textContent()) ?? "";
  await dialog.getByLabel("Nhóm").selectOption({ label: group });
  const name = `e2e-tai-lieu-${Date.now()}.txt`;
  await dialog.getByLabel("Tệp").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from("tài liệu e2e") });
  await dialog.getByRole("button", { name: "Tải lên" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Tìm tệp").fill("tai-lieu");
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText(group, { exact: true })).toBeVisible();
});

test("Họp: lên lịch rồi thấy trên lịch tuần, vào được phòng", async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await signedIn(browser, fixtures().users.alice);
  await page.goto("/app/meetings");
  await page.getByRole("button", { name: "Lên lịch" }).click();
  const dialog = page.getByRole("dialog");
  const group = (await dialog.getByLabel("Nhóm").locator("option").filter({ hasText: /^E2E \d+$/ }).first().textContent()) ?? "";
  await dialog.getByLabel("Nhóm").selectOption({ label: group });
  const title = `Họp e2e ${Date.now()}`;
  await dialog.getByLabel("Tên cuộc họp").fill(title);
  await dialog.getByRole("button", { name: "Tạo lịch họp" }).click();
  await expect(dialog).toHaveCount(0);
  // Created an hour from now: on this week's grid, or next week's once that hour is past Sunday.
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Vào", exact: true }).click();
  const enter = async () => {
    await page.getByRole("button", { name: "Vào phòng" }).click();
    await expect.poll(() => playingVideos(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  };
  await enter();
  // Leaving goes back to the calendar, not to the room's device check.
  await page.getByRole("button", { name: "Rời khỏi phòng họp" }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Rời phòng" });
  if (await confirm.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await confirm.click();
  await expect(page.getByRole("button", { name: "Hôm nay" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vào phòng" })).toHaveCount(0);
  // In a call, the "Họp" item shows the room, not the calendar.
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("button", { name: "Vào", exact: true }).click();
  await enter();
  // The room covers the app; "Thu nhỏ" goes back to the app with the call still running,
  // and the "Họp" item (now "Họp đang diễn ra") brings the room back.
  await page.getByRole("button", { name: "Thu nhỏ cuộc họp" }).click();
  await page.locator(".tdtu-sidebar").getByRole("button", { name: /^Họp( |$)/ }).click();
  await expect.poll(() => playingVideos(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Hôm nay" })).toHaveCount(0);
});
