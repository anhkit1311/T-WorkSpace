# SYSTEM IMPLEMENTATION

This chapter describes how the blocks of Chapter 3 are implemented. Following the guidelines of the faculty, it does not reproduce the source code; it presents the algorithms as diagrams and quotes only the short pieces of code that carry the key ideas. The listings are shortened, and comments in English were added for the report.

## Source code organisation

The project is an npm-workspaces monorepo written entirely in TypeScript (Table 4.1). Each feature (authentication, workspaces, chat, meetings, tasks, files, profiles) has its own routes and services on the server and its own pages, components and API client on the browser side. The Socket.IO contract (`ClientToServerEvents`, `ServerToClientEvents`) lives in the shared package, so the compiler checks both sides of every event.

TABLE: Table 4.1. Structure of the source code
| Folder | Content |
| --- | --- |
| `apps/web` | React single-page client: application providers and layout, `features/<module>`, shared UI |
| `services/api` | Node.js server: `modules/<domain>`, infrastructure (database, real-time, e-mail), 20 SQL migrations |
| `packages/shared` | Data types and the Socket.IO event contract shared by client and server |
| `experiments` | Mesh/SFU media laboratory and packet-capture analyser (Chapter 5) |
| `scripts` | WebSocket benchmark, backup/restore verification, test fixtures |
| `infra` | Docker Compose files for development and production, Nginx configuration |

The code base contains about 17,500 lines of TypeScript/TSX and 13,000 lines of CSS in the client, about 7,000 lines of TypeScript in the server and 470 lines in the shared package.

## Real-time core

### Authentication and per-event authorisation

The Socket.IO server shares the HTTP server with the REST API and applies two middleware layers. When a socket connects, the access token from the handshake is verified and the user is loaded; connections without a valid token are rejected. Then, before **every** event, a second middleware applies the checks shown in Figure 4.1: a burst limit per socket, re-verification of the token, a rate limit of 120 write operations per minute per user, a check of the **current** channel permission in the database (not the rooms the socket joined earlier) and, for media signalling, a check that the socket is inside that meeting and has been admitted. A user in the waiting room or one who was removed therefore cannot create transports, produce or consume media.

FIG: fig-4-1-authz.png | Figure 4.1. Per-event authorisation pipeline of the Socket.IO gateway | 14

Listing 4.1 shows the core of this middleware. The event name selects which checks apply.

CODE: Listing 4.1. Per-event authorisation middleware (services/api/src/infrastructure/realtime/socket.ts, shortened)
```ts
socket.use(async ([event, data, ack], next) => {
  try {
    if (++burstCount > 250) throw new Error("Too many operations");
    await verifyAccessToken(token);                   // token may have expired
    if (WRITE_EVENTS.includes(event))
      await limitActor(user.id, "realtime-write", 120, 60);
    if (["join_channel", "send_message", "typing"].includes(event))
      // current rights read from the database, not from joined rooms
      await requireChannelAccess(user.id, data?.channelId);
    if (MEDIA_EVENTS.includes(event)) {
      await requireChannelAccess(user.id, data?.roomId, true);
      if (event !== "join_meeting" && activeMeetingRoomId !== data.roomId)
        throw new Error("You have not joined this room");
      if (event !== "join_meeting")
        // not in the waiting room, not removed
        await requireAdmitted(user.id, data.roomId, socket.id);
    }
    next();
  } catch (error) { reply(ack, error); }
});
```

Revocation takes effect immediately: the server emits `access_revoked` to the room `user:<id>` and disconnects all sockets of that user.

### Exactly-once message storage

Figure 4.2 is the flowchart of `send_message`. The server validates the content (at most 4,000 characters) and the attachment, opens a transaction, locks the workspace and channel rows in share mode and re-checks the write permission inside the transaction, so a concurrent removal cannot slip in between the check and the insert. It then takes a transaction-scoped advisory lock on (author, channel, clientMessageId) and looks for an existing message with the same identifier. Three outcomes are possible: no message exists, so the message is inserted, mentions and notifications are created and `new_message` is emitted after commit; the same identifier exists with the same content fingerprint, which means the client is retrying after a lost acknowledgement, so the stored message is returned **without** a new broadcast; or the identifier exists with different content, which is reported as a conflict.

FIG: fig-4-2-send-message.png | Figure 4.2. Flowchart of idempotent message sending on the server | 14

Listing 4.2 shows the deduplication step inside the transaction. The content fingerprint (`payloadHash`) is a SHA-256 hash of the content, the reply target, the attachment, the thread root and the mentioned users, computed before the transaction starts.

CODE: Listing 4.2. Deduplication inside the send-message transaction (services/api/src/modules/workspaces/service.ts, shortened)
```ts
const result = await withTransaction(async (client) => {
  // Hold the current membership until the insert commits
  const access = await client.query(`SELECT m.user_id FROM memberships m ...
       AND EXISTS (SELECT 1 FROM channel_access a WHERE ... AND a.can_write)
       FOR SHARE OF m`, [channelId, userId]);
  if (!access.rowCount) throw new HttpError(403, "FORBIDDEN", "...");
  if (options.clientMessageId) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`${userId}:${channelId}:${options.clientMessageId}`]);
    const previous = await client.query(
      `SELECT ..., client_payload_hash AS "payloadHash" FROM messages
       WHERE channel_id=$1 AND author_id=$2 AND client_message_id=$3`,
       [channelId, userId, options.clientMessageId]);
    if (previous.rowCount) {
      if (previous.rows[0].payloadHash !== payloadHash)
        throw new HttpError(409, "DELIVERY_CONFLICT", "...");
      // retry after a lost ACK: return the stored message, no broadcast
      deduplicated = true;
      return previous;
    }
  }
  return client.query(
    `INSERT INTO messages (..., client_message_id, client_payload_hash) ...`);
});
```

New messages are emitted to the `user:<id>` rooms of the users who can **currently** read the channel, determined with the `channel_access` view, rather than to a workspace-wide room; content of a private channel therefore never reaches a member who is not in that channel. On the client, unconfirmed messages are kept in an IndexedDB outbox that survives a reload and are resent with the same `clientMessageId`. After a reconnection the client calls `GET /api/channels/:id/messages?after=<cursor>` to fetch the messages it missed and merges them by identifier. Together with the unique constraint on (author, clientMessageId), this gives *at-least-once* delivery on the network and *exactly-once* storage in the database.

### Presence and typing

Presence is implemented with an in-memory connection counter per user and a `socket_presence` table that makes presence consistent across processes (Table 4.2). Figure 4.3 shows the heartbeat that runs every 15 seconds on each API process.

TABLE: Table 4.2. Implementation of presence and typing
| Component | Implementation |
| --- | --- |
| Connection counting | A map from user to number of sockets; online when the count goes from 0 to 1, offline when it goes from 1 to 0 |
| Cross-process state | `socket_presence(socket_id, user_id, instance_id, expires_at)` with a 45-second TTL |
| Heartbeat | Every 15 s: renew the TTL of live sockets, delete expired rows, clean up meetings of dead processes, send `online_users` to each socket |
| Broadcast scope | `user_presence` only to workspaces the user belongs to; respects the user's "show activity" setting |
| Typing | `typing {channelId, isTyping}` → permission check → `user_typing` to the other members of the channel; not stored |

FIG: fig-4-3-presence.png | Figure 4.3. Presence heartbeat executed by each API process every 15 seconds | 12

Because the online list is computed from rows whose `expires_at` is in the future, a user connected to process A is visible to a user connected to process B, and when a process is killed its rows expire within at most 45 seconds and its users become offline.

### Multi-process event distribution

With `SOCKET_ADAPTER=postgres`, Socket.IO uses the PostgreSQL adapter: a call to `io.to(room).emit(...)` is published through `LISTEN/NOTIFY` and the other processes re-emit it to their local sockets. Each process holds a lease row in `api_instances` that it renews every 15 seconds and that expires after 45 seconds. The integration test `distributed.test.js` starts two real API processes and verifies that messages, task updates and notifications cross processes.

## Conferencing core

### Worker pool and room placement

The room manager keeps a pool of mediasoup workers (`MEDIASOUP_WORKERS`, two by default, at most eight). When a meeting starts, the room manager places its router on the worker that currently hosts the fewest rooms (Listing 4.3). If a worker dies, its rooms are closed, their participants receive `media_failure` and are asked to rejoin, rooms on other workers are not affected, and the next join creates a replacement worker; the test `worker-recovery.test.js` kills a real worker to verify this behaviour.

CODE: Listing 4.3. Choosing the least-loaded worker (services/api/src/modules/meetings/media/room-manager.ts)
```ts
const worker = [...this.workers].sort(
  (a, b) =>
    (this.allocations.get(a.pid) ?? 0) - (this.allocations.get(b.pid) ?? 0),
)[0];
if (!worker) throw new Error("Media worker unavailable");
this.allocations.set(worker.pid, (this.allocations.get(worker.pid) ?? 0) + 1);
return worker;
```

Routers use Opus 48 kHz stereo and VP8 with a start bitrate of 1 Mbps. Each WebRTC transport enables UDP and TCP, prefers UDP and announces `MEDIASOUP_ANNOUNCED_IP`, which must be the public address in production and the LAN address (not `127.0.0.1`) in development, for the reason explained in Section 5.4.2.

### Producer and consumer lifecycle

- `produce` checks the limit of sources per participant (by default three: microphone, camera and screen), accepts only those three kinds and emits `new_producer` to the other participants.
- `consume` checks `router.canConsume`, creates the consumer **paused** and resumes it only after the client sends `resume_consumer`, once the track is attached, so the first key frame is not lost.
- `consumer_layer` sets the preferred spatial layer of a simulcast consumer, and `pause_consumer` stops forwarding a stream that is not displayed. When the consumer is resumed, mediasoup requests a new key frame automatically.
- Closing a producer or a transport closes the dependent consumers, and `peer_left` tells the clients to remove the tile.

### Meeting sessions and moderation

Meeting state is stored in PostgreSQL so that every process sees the same session. Each channel has at most one active session (enforced by a partial unique index), and the first person who joins becomes the host. Joining locks the session row, checks the limits on users and on tabs per user, and checks the lock and waiting-room flags; the result is *admitted* or *waiting*. A waiting participant has a socket but no SFU peer. The `meeting_action` event implements waiting room and lock (host and co-host), admit, remove and mute (host and co-host, never against the host), appoint co-host, transfer and end (host only), and raise hand (everyone). The session row also records the media instance that owns the meeting, and `GET /api/channels/:id/media-location` returns the SFU endpoint of that instance.

### NAT traversal and ICE recovery

With every transport the server returns the list of ICE servers. If TURN is configured, it generates a time-limited credential as described in Section 2.2.2 (Listing 4.4).

CODE: Listing 4.4. Time-limited TURN credential (services/api/src/modules/meetings/media/ice.ts)
```ts
// valid for one hour
const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
return [{
  urls,                                       // from TURN_URLS
  username,
  credential: createHmac("sha1", process.env.TURN_SHARED_SECRET)
    .update(username)
    .digest("base64"),
}];
```

On the client, every transport is watched for connection-state changes (Figure 4.4). If the transport stays *disconnected* for 5 seconds, or becomes *failed*, the client asks the server for new ICE parameters and calls `transport.restartIce()`, at most twice. If the transport is still not connected 10 seconds after a restart, the user is told to rejoin.

FIG: fig-4-4-ice-recovery.png | Figure 4.4. State diagram of ICE recovery on the client | 14

## Conferencing client and dynamic video grid

### Capture and publishing

The lobby lets users preview the camera and microphone, choose devices and a capture quality (640×360, 960×540 or 1280×720) before joining. Only sources that are switched on are published; all four microphone/camera combinations were tested to make sure that a disabled source is never sent. The camera is published with three simulcast encodings *q* (quarter resolution, 150 kbps), *h* (half, 400 kbps) and *f* (full, 1,200 kbps). Screen sharing uses `getDisplayMedia()` and is published as a separate, non-simulcast source that closes automatically when the user stops sharing from the browser bar. Muting uses `track.enabled` together with `producer.pause()`, so unmuting is immediate and does not renegotiate the transport.

### QoS collection

A QoS collector reads `getStats()` from both transports every 2.5 seconds. RTT is taken from the selected candidate pair; jitter is the maximum over the inbound RTP streams; bitrates are computed from the change in bytes over the change in time; and packet loss is computed per window from the change in received and lost packet counters (Listing 4.5). The interface keeps the latest 300 samples (about 12.5 minutes) and can export them as CSV or JSON.

CODE: Listing 4.5. Windowed packet-loss computation (apps/web/src/features/meetings/webrtc/qos.ts, shortened)
```ts
if (old && sample.timestamp > old.timestamp &&
    counter.received >= old.received && counter.lost >= old.lost) {
  deltaPackets += counter.received - old.received;  // counters may be reset:
  deltaLost += Math.max(0, counter.lost - old.lost); // such windows are skipped
  hasLoss = true;
}
...
packetLoss: hasLoss && deltaPackets + deltaLost > 0
  ? (100 * deltaLost) / (deltaPackets + deltaLost)
  : null,                                            // no data is not "0% loss"
```

### Dynamic grid and demand-driven layers

The aim of the grid is that the browser only decodes and draws what the user actually sees, at the resolution it needs. Figure 4.5 summarises the algorithm.

FIG: fig-4-5-grid.png | Figure 4.5. Demand-driven video grid: from tile layout to SFU requests | 15

1. **Best layout.** For n tiles in a container of width W and height H, the algorithm tries every column count c from 1 to n, computes the number of rows r = ⌈n/c⌉ and the tile width w = min((W − gap·(c−1))/c, (H − gap·(r−1))/r · 16/9), and keeps the c that maximises w (Listing 4.6).
2. **Pagination.** A page holds 4, 6 or 9 tiles depending on the width. Tiles outside the current page are not rendered, but the audio of those participants keeps playing through separate audio elements.
3. **Layer per tile.** The smallest simulcast layer whose width still covers the tile in device pixels is selected: with a 960-pixel source, tiles up to 264 px use layer 0, up to 528 px layer 1, otherwise layer 2 (Listing 4.7).
4. **Pushing demand to the SFU.** For each participant the page computes the demand: `null` if the tile is not visible, otherwise a layer. The meeting provider compares it with the demand already applied to each consumer and sends only the differences: `pause_consumer` when a tile disappears, `resume_consumer` followed by `consumer_layer` when it reappears, and `consumer_layer` when its size changes. When the meeting page is not open (the user went to chat while staying in the call), the demand is removed and a default policy based on the number of cameras is used (more than six → layer 0, more than two → layer 1, otherwise layer 2).

CODE: Listing 4.6. Choosing the column count that gives the largest 16:9 tile (apps/web/src/features/meetings/grid-layout.ts)
```ts
for (let columns = 1; columns <= tiles; columns++) {
  const rows = Math.ceil(tiles / columns);
  const byWidth = (width - gap * (columns - 1)) / columns;
  const byHeight = ((height - gap * (rows - 1)) / rows) * aspect;
  const tileWidth = Math.max(0, Math.min(byWidth, byHeight));
  if (tileWidth > best.tileWidth)
    best = { columns, rows, tileWidth, tileHeight: tileWidth / aspect };
}
```

CODE: Listing 4.7. Selecting the simulcast layer for a tile (apps/web/src/features/meetings/grid-layout.ts)
```ts
export function layerForTile(
  cssWidth: number, devicePixelRatio = 1, sourceWidth = 960) {
  if (cssWidth <= 0) return null;          // not rendered: pause the consumer
  const needed = cssWidth * devicePixelRatio;
  if (needed <= (sourceWidth / 4) * 1.1) return 0; // q layer
  if (needed <= (sourceWidth / 2) * 1.1) return 1; // h layer
  return 2;                                        // f layer
}
```

As a result, the downlink of a client is proportional to the number and the size of the **visible** tiles rather than to the total number of participants in the room. Section 5.4.6 measures the effect of layer selection.

## User interface

The client was implemented as a responsive single-page application with a Vietnamese interface. Figure 4.6 shows the home page, which prioritises the user's work: assigned tasks, upcoming meetings and notifications, with shortcuts to create a workspace or open a meeting.

FIG: ui-home.png | Figure 4.6. Home page with assigned tasks, upcoming meetings and notifications | 14

Figure 4.7 shows a workspace with its channel list and an open text channel. The header shows the number of members and how many are online, the tabs switch between the overview, tasks, chat, meetings and files of the workspace, and the composer supports emoji, attachments and voice messages.

FIG: ui-chat.png | Figure 4.7. Workspace view with the channel list and a text channel | 14

Figure 4.8 shows a video channel. The moderation panel offers the host the waiting room, room lock, "end for everyone" and raise hand, and the grid can be switched between grid and focus layouts.

FIG: ui-meeting.png | Figure 4.8. Video channel with the moderation panel and layout switch | 14

Figure 4.9 shows the administration page, where owners and admins edit the workspace, manage members, invitations and channels, archive the workspace and read the audit log.

FIG: ui-admin.png | Figure 4.9. Workspace administration page | 14

The layout adapts to tablets and phones; Figure 4.10 shows the chat and meeting views at a width of 375 pixels.

FIG: ui-mobile.png | Figure 4.10. Chat (left) and meeting (right) views on a 375-pixel-wide phone screen | 11

## Deployment

The production deployment, shown in Figure 4.11, uses Docker Compose with three services: `postgres`; `api`, which runs Node.js and mediasoup and publishes the media port range 40000–40099 over UDP and TCP directly; and `web`, an Nginx server that serves the client, terminates TLS and proxies `/api` and `/socket.io` to the API. A separate coturn server provides STUN/TURN with the same shared secret as the API. The `/ready` health check succeeds only when PostgreSQL is reachable and all migrations have been applied. The environment variables for multi-process operation (`SOCKET_ADAPTER=postgres`, `API_INSTANCE_ID`, `SFU_PUBLIC_URL`) are available, but a multi-node deployment on real infrastructure has not been validated (Section 5.7).

FIG: fig-4-11-deploy.png | Figure 4.11. Production deployment with Docker Compose | 15

## Chapter summary

The server authorises every Socket.IO event against the current state of the database, stores each message exactly once through an advisory lock and a uniqueness constraint, and keeps presence consistent across processes with a TTL table. The conferencing core places each meeting on the least-loaded mediasoup worker, starts consumers paused, recovers ICE automatically and issues time-limited TURN credentials. The client publishes simulcast video and requests from the SFU only the layers that its visible tiles need. Chapter 5 evaluates these mechanisms.
