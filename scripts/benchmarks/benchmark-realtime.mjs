import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { io } from "socket.io-client";

process.env.JWT_SECRET = "empirical-benchmark-secret-key-32-chars!!";

import { pool } from "../../dist/api/infrastructure/database/db.js";
import { createApiServer } from "../../dist/api/server.js";
import { createAccessToken } from "../../dist/api/modules/auth/tokens.js";
import { roomManager } from "../../dist/api/modules/meetings/media/room-manager.js";
import {
  addWorkspaceMember,
  createWorkspace,
  getWorkspaceChannels,
} from "../../dist/api/modules/workspaces/service.js";

const TIERS = [1, 3, 5, 8];
const CHAT_BURST_COUNT = 15; // Number of test messages per tier

function formatBytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function calculatePercentile(numbers, p) {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runBenchmark() {
  console.log("================================================================================");
  console.log("  REAL-TIME COLLABORATIVE WORKSPACE: EMPIRICAL BENCHMARK SUITE");
  console.log("  Evaluating Socket.IO chat and SFU signaling / transport allocation");
  console.log("================================================================================");

  const envInfo = {
    osType: os.type(),
    osPlatform: os.platform(),
    osRelease: os.release(),
    osArch: os.arch(),
    cpuModel: os.cpus()[0]?.model || "Unknown CPU",
    cpuCores: os.cpus().length,
    totalRamGB: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2),
    nodeVersion: process.version,
    testTimestamp: new Date().toISOString(),
    networkEnvironment: "Local loopback (127.0.0.1) IPC / WebSocket",
  };

  console.log(
    `Hardware: ${envInfo.cpuModel} (${envInfo.cpuCores} cores), ${envInfo.totalRamGB} GB RAM`,
  );
  console.log(
    `OS: ${envInfo.osType} ${envInfo.osRelease} (${envInfo.osArch}), Node: ${envInfo.nodeVersion}`,
  );
  console.log(`Network: ${envInfo.networkEnvironment}`);
  console.log("--------------------------------------------------------------------------------\n");

  const server = createApiServer().listen(0);
  await once(server, "listening");
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const benchmarkResults = [];

  try {
    for (const concurrency of TIERS) {
      console.log(`>>> Starting Tier: Concurrency = ${concurrency} client(s)...`);

      // 1. Create workspace & users
      const ownerId = randomUUID();
      const userIds = [ownerId];
      for (let i = 1; i < concurrency; i++) {
        userIds.push(randomUUID());
      }

      for (const uid of userIds) {
        await pool.query(
          `INSERT INTO users (id, email, password_hash, display_name)
           VALUES ($1, $2, 'bench-password', $3)`,
          [uid, `bench-${uid}@test.local`, `BenchUser-${uid.slice(0, 6)}`],
        );
      }

      const workspace = await createWorkspace(ownerId, `BenchWorkspace-${concurrency}`);
      for (const uid of userIds) {
        await addWorkspaceMember(workspace.id, uid);
      }

      const channels = await getWorkspaceChannels(ownerId, workspace.id);
      const textChannel = channels.find((c) => c.type === "text");
      const videoChannel = channels.find((c) => c.type === "video");
      assert.ok(textChannel, "Text channel exists");
      assert.ok(videoChannel, "Video channel exists");

      // Measure CPU & Memory baseline for this tier
      const initialCpu = process.cpuUsage();
      const startTime = performance.now();

      // 2. Connect N clients
      const connectStart = performance.now();
      const clientSockets = [];
      for (const uid of userIds) {
        const token = await createAccessToken(uid);
        const socket = io(baseUrl, {
          auth: { token },
          transports: ["websocket"],
          forceNew: true,
          reconnection: false,
        });
        clientSockets.push(socket);
      }

      await Promise.all(
        clientSockets.map(
          (s) =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("Socket connect timeout")), 5000);
              s.on("connect", () => {
                clearTimeout(timer);
                resolve();
              });
              s.on("connect_error", (err) => {
                clearTimeout(timer);
                reject(err);
              });
            }),
        ),
      );
      const connectDuration = performance.now() - connectStart;

      // Join text channel
      for (const s of clientSockets) {
        s.emit("join_channel", { channelId: textChannel.id });
      }
      await new Promise((r) => setTimeout(r, 100));

      // 3. Realtime Chat Broadcast Latency (RTT)
      const rttMeasurements = [];
      const burstStart = performance.now();

      for (let m = 0; m < CHAT_BURST_COUNT; m++) {
        const senderIdx = m % concurrency;
        const sender = clientSockets[senderIdx];
        const content = `Benchmark message #${m + 1} (concurrency: ${concurrency})`;

        // Prepare listeners on all receiving sockets
        const receivePromises = clientSockets.map((sock) => {
          return new Promise((resolve) => {
            const onMsg = (msg) => {
              if (msg.content === content) {
                sock.off("new_message", onMsg);
                resolve(performance.now());
              }
            };
            sock.on("new_message", onMsg);
          });
        });

        const tSend = performance.now();
        const sendAck = await sender
          .timeout(5000)
          .emitWithAck("send_message", { channelId: textChannel.id, content });
        assert.equal(sendAck.success, true);

        const receiveTimestamps = await Promise.all(receivePromises);
        // End-to-end broadcast latency on loopback, not network RTT or WebRTC RTT.
        const maxRecvTime = Math.max(...receiveTimestamps);
        const rtt = maxRecvTime - tSend;
        rttMeasurements.push(rtt);
      }
      const burstDuration = (performance.now() - burstStart) / 1000; // seconds
      const throughput = (CHAT_BURST_COUNT / burstDuration).toFixed(1);

      const minRtt = Math.min(...rttMeasurements).toFixed(2);
      const maxRtt = Math.max(...rttMeasurements).toFixed(2);
      const avgRtt = (rttMeasurements.reduce((a, b) => a + b, 0) / rttMeasurements.length).toFixed(
        2,
      );
      const p50Rtt = calculatePercentile(rttMeasurements, 50).toFixed(2);
      const p95Rtt = calculatePercentile(rttMeasurements, 95).toFixed(2);

      // 4. Mediasoup signaling and transport allocation only; no ICE/DTLS/RTP.
      const sfuJoinStart = performance.now();
      const joinAcks = await Promise.all(
        clientSockets.map((s) =>
          s.timeout(10000).emitWithAck("join_meeting", { roomId: videoChannel.id }),
        ),
      );
      assert.ok(joinAcks.every((r) => r.success));
      const sfuJoinLatency = (performance.now() - sfuJoinStart) / concurrency;

      // WebRTC Transports Creation (Send & Recv transports per peer => 2 * N transports)
      const transportCreateStart = performance.now();
      const sendTransports = await Promise.all(
        clientSockets.map((s) =>
          s.timeout(10000).emitWithAck("create_webrtc_transport", { roomId: videoChannel.id }),
        ),
      );
      const recvTransports = await Promise.all(
        clientSockets.map((s) =>
          s.timeout(10000).emitWithAck("create_webrtc_transport", { roomId: videoChannel.id }),
        ),
      );
      assert.ok(sendTransports.every((r) => r.success));
      assert.ok(recvTransports.every((r) => r.success));
      const transportCreateLatency = (performance.now() - transportCreateStart) / (concurrency * 2);

      // Retrieve authentic mediasoup worker transport stats
      const roomStats = await roomManager.getRoomStats(videoChannel.id);

      // SFU Cleanup
      for (const s of clientSockets) {
        await s.timeout(5000).emitWithAck("leave_meeting", { roomId: videoChannel.id });
      }

      // 5. Measure only this Node.js process; mediasoup worker is a separate process.
      const totalElapsedMs = performance.now() - startTime;
      const cpuDelta = process.cpuUsage(initialCpu);
      const totalCpuMicroseconds = cpuDelta.user + cpuDelta.system;
      const cpuPercent = ((totalCpuMicroseconds / (totalElapsedMs * 1000)) * 100).toFixed(2);

      const mem = process.memoryUsage();
      const rssMb = formatBytes(mem.rss);
      const heapUsedMb = formatBytes(mem.heapUsed);
      const heapTotalMb = formatBytes(mem.heapTotal);

      // Clean up sockets & test data
      for (const s of clientSockets) {
        s.disconnect();
      }
      // Let the server's disconnect handlers (meeting summary writes) finish, or the cascade delete deadlocks with them.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await pool.query(`DELETE FROM workspaces WHERE id = $1`, [workspace.id]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);

      const resultTier = {
        concurrency,
        connectLatencyMs: parseFloat(connectDuration.toFixed(2)),
        chatMinRttMs: parseFloat(minRtt),
        chatMaxRttMs: parseFloat(maxRtt),
        chatAvgRttMs: parseFloat(avgRtt),
        chatP50RttMs: parseFloat(p50Rtt),
        chatP95RttMs: parseFloat(p95Rtt),
        chatThroughputMsgPerSec: parseFloat(throughput),
        sfuAvgJoinLatencyMs: parseFloat(sfuJoinLatency.toFixed(2)),
        sfuAvgTransportCreateLatencyMs: parseFloat(transportCreateLatency.toFixed(2)),
        sfuAllocatedTransports: concurrency * 2,
        sfuInspectedPeers: roomStats.length,
        cpuUsagePercent: parseFloat(cpuPercent),
        rssMb: parseFloat(rssMb),
        heapUsedMb: parseFloat(heapUsedMb),
        heapTotalMb: parseFloat(heapTotalMb),
      };

      benchmarkResults.push(resultTier);
      console.log(
        `  -> Connect: ${resultTier.connectLatencyMs}ms | Chat Avg RTT: ${resultTier.chatAvgRttMs}ms (p95: ${resultTier.chatP95RttMs}ms) | SFU Join: ${resultTier.sfuAvgJoinLatencyMs}ms | CPU: ${resultTier.cpuUsagePercent}% | RSS: ${resultTier.rssMb}MB`,
      );
      console.log("");
    }
  } finally {
    roomManager.close();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }

  // 6. Export Benchmark Artifacts
  const outputDir = path.resolve(process.cwd(), "docs/benchmarks");
  await fs.mkdir(outputDir, { recursive: true });

  const finalReport = {
    environment: envInfo,
    benchmarkResults,
  };

  // JSON
  const jsonPath = path.join(outputDir, "benchmark-results.json");
  await fs.writeFile(jsonPath, JSON.stringify(finalReport, null, 2), "utf8");
  console.log(`Saved JSON benchmark results: ${jsonPath}`);

  // CSV
  const csvHeaders = [
    "Concurrency",
    "Connect Latency (ms)",
    "Chat Min RTT (ms)",
    "Chat Avg RTT (ms)",
    "Chat p95 RTT (ms)",
    "Chat Max RTT (ms)",
    "Chat Throughput (msg/s)",
    "SFU Join Latency (ms)",
    "SFU Transport Create Latency (ms)",
    "Allocated Transports",
    "CPU Usage (%)",
    "Memory RSS (MB)",
    "Memory Heap Used (MB)",
  ];
  const csvRows = benchmarkResults.map((r) => [
    r.concurrency,
    r.connectLatencyMs,
    r.chatMinRttMs,
    r.chatAvgRttMs,
    r.chatP95RttMs,
    r.chatMaxRttMs,
    r.chatThroughputMsgPerSec,
    r.sfuAvgJoinLatencyMs,
    r.sfuAvgTransportCreateLatencyMs,
    r.sfuAllocatedTransports,
    r.cpuUsagePercent,
    r.rssMb,
    r.heapUsedMb,
  ]);
  const csvContent = [csvHeaders.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
  const csvPath = path.join(outputDir, "benchmark-results.csv");
  await fs.writeFile(csvPath, csvContent, "utf8");
  console.log(`Saved CSV benchmark results: ${csvPath}`);

  // Markdown Report
  const mdRows = benchmarkResults
    .map(
      (r) =>
        `| **${r.concurrency}** | ${r.connectLatencyMs} ms | ${r.chatAvgRttMs} ms | ${r.chatP95RttMs} ms | ${r.chatThroughputMsgPerSec} | ${r.sfuAvgJoinLatencyMs} ms | ${r.sfuAvgTransportCreateLatencyMs} ms | ${r.cpuUsagePercent}% | ${r.rssMb} MB |`,
    )
    .join("\n");

  const mdReport = `# BÁO CÁO ĐO KIỂM THỰC NGHIỆM HỆ THỐNG CỘNG TÁC THỜI GIAN THỰC & SFU WEBRTC

> **Đề tài luận văn**: *Phát triển nền tảng không gian làm việc cộng tác thời gian thực tích hợp hội nghị truyền hình đa điểm*  
> **Thời điểm đo kiểm**: \`${envInfo.testTimestamp}\`  
> **Phạm vi đo**: Socket.IO trên loopback, ghi tin vào PostgreSQL, join signaling và cấp phát transport mediasoup. Không thiết lập ICE/DTLS, không truyền RTP và không đo chất lượng audio/video.

---

## 1. Môi trường và điều kiện thực nghiệm

| Thông số phần cứng / phần mềm | Giá trị thực tế ghi nhận |
| :--- | :--- |
| **CPU** | ${envInfo.cpuModel} (${envInfo.cpuCores} logical cores) |
| **Dung lượng RAM** | ${envInfo.totalRamGB} GB |
| **Hệ điều hành** | ${envInfo.osType} ${envInfo.osRelease} (${envInfo.osPlatform} ${envInfo.osArch}) |
| **Môi trường thực thi** | Node.js ${envInfo.nodeVersion}, V8 Engine, C++ mediasoup worker 3.26.0 |
| **Cơ sở dữ liệu** | PostgreSQL 16 trong Docker container (\`infra-postgres-1\`) |
| **Điều kiện truyền dẫn** | Loopback \`127.0.0.1\` / WebSocket; 15 tin nhắn tuần tự mỗi mức tải. |

---

## 2. Bảng tổng hợp kết quả đo kiểm hiệu năng theo số lượng Client

| Số Client (N) | Kết nối Socket | Chat Avg RTT | Chat p95 RTT | Chat Thông lượng (msg/s) | SFU Join Latency | SFU Transport Alloc | CPU Sử dụng | Bộ nhớ RSS |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${mdRows}

---

## 3. Phân tích kết quả thực nghiệm khoa học

1. **Chat**: Cột Chat RTT là thời gian từ phát lệnh gửi đến client chậm nhất nhận broadcast trên loopback. Mỗi mức tải chỉ có 15 mẫu; p95 có độ phân giải thấp và không đại diện mạng thực.
2. **SFU signaling**: Join và cấp phát 2 transport mỗi client thành công. Chưa kiểm chứng ICE/DTLS, publish/consume RTP, jitter, packet loss hay bitrate.
3. **Tài nguyên**: CPU và RSS đo tiến trình Node.js chạy benchmark cùng API. Không bao gồm CPU/RAM mediasoup worker và PostgreSQL; không suy diễn tổng tài nguyên server.
4. **Dữ liệu gốc**: JSON/CSV hiện lưu số tổng hợp theo mức tải, chưa lưu từng mẫu chat hoặc số đo trình duyệt. Cần chạy ca đo có log per-sample và WebRTC getStats trước khi dùng làm kết quả QoS luận văn.

---
*Tệp dữ liệu gốc được lưu trữ tại:*
- JSON thô: \`docs/benchmarks/benchmark-results.json\`
- Bảng tính CSV: \`docs/benchmarks/benchmark-results.csv\`
`;

  const mdPath = path.join(outputDir, "benchmark-report.md");
  await fs.writeFile(mdPath, mdReport, "utf8");
  console.log(`Saved Markdown benchmark report: ${mdPath}`);

  console.log("\n================================================================================");
  console.log("  SIGNALING BENCHMARK COMPLETED; RTP/QoS NOT MEASURED");
  console.log("================================================================================");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
