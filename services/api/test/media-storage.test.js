import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { config } from "../../../dist/api/config/config.js";
import { archiveMedia, openMedia, openMediaPath } from "../../../dist/api/infrastructure/media-storage.js";

test("media is served from the local disk; without MEDIA_STORAGE=s3 nothing goes to a bucket", async () => {
  delete process.env.MEDIA_STORAGE;
  const dir = `test-media-${process.pid}`;
  await mkdir(path.join(config.mediaDir, dir), { recursive: true });
  try {
    await writeFile(path.join(config.mediaDir, dir, "index.m3u8"), "#EXTM3U\n");
    const found = await openMedia(dir, "index.m3u8");
    assert.equal(found.size, 8);
    found.stream.destroy();
    const viaPath = await openMediaPath(path.join(config.mediaDir, dir, "index.m3u8"));
    assert.equal(viaPath.size, 8);
    viaPath.stream.destroy();
    assert.equal(await openMedia(dir, "index_00001.ts"), null, "missing and no bucket");
    assert.equal(await archiveMedia(dir), 0, "archiving is off by default");
  } finally {
    await rm(path.join(config.mediaDir, dir), { recursive: true, force: true });
  }
});
