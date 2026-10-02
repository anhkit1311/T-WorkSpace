import type { RouteContext } from "../../shared/http/context.js";
import { getAuthUserId, readBinary, sendJson } from "../../shared/http/utils.js";
import { limitRequest } from "../../shared/http/rate-limit.js";
import { cleanFileName } from "./validation.js";
import { uploadFile, downloadFile } from "./service.js";
export async function fileRoutes({ request, response, pathname }: RouteContext): Promise<void> {
  const upload = pathname.match(/^\/api\/channels\/([^/]+)\/attachments$/);
  if (upload && request.method === "POST") {
    const userId = await getAuthUserId(request);
    await limitRequest(request, "upload:" + userId, 30, 60);
    const mime = String(request.headers["content-type"] ?? "")
      .split(";")[0]
      .toLowerCase();
    sendJson(response, 201, {
      attachment: await uploadFile(
        userId,
        upload[1],
        cleanFileName(request.headers["x-file-name"]),
        mime,
        await readBinary(request, 8000000),
      ),
    });
    return;
  }
  const download = pathname.match(/^\/api\/attachments\/([^/]+)$/);
  if (download && request.method === "GET") {
    const { metadata, data } = await downloadFile(await getAuthUserId(request), download[1]);
    response.statusCode = 200;
    response.setHeader("Content-Type", metadata.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Disposition",
      `${metadata.mimeType.startsWith("image/") || metadata.mimeType.startsWith("audio/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.end(data);
    return;
  }
}
