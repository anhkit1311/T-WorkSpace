import { createApiServer, closeApiServer } from "../../../../dist/api/server.js";
import process from "node:process";
import { pool } from "../../../../dist/api/infrastructure/database/db.js";
import { roomManager } from "../../../../dist/api/modules/meetings/media/room-manager.js";
const server = createApiServer();
server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
process.on("message", async (message) => {
  if (message?.type === "metrics")
    process.send({
      id: message.id,
      pid: process.pid,
      cpu: process.cpuUsage(),
      memory: process.memoryUsage(),
      media: roomManager.metrics(),
      workers: await roomManager.resourceUsage(),
      db: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    });
  if (message === "stop") {
    await closeApiServer(server);
    roomManager.close();
    await pool.end();
    process.exit(0);
  }
});
