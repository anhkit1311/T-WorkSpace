# SYSTEM BLOCK DIAGRAM AND DESIGN

This chapter starts from the requirements, presents the block diagram of the whole system, and then analyses each block: what it contains, what it is responsible for and how it works with the other blocks. The last sections describe the database, the access-control model and the real-time protocols that connect the blocks.

## Requirements analysis

### Actors

Table 3.1 lists the actors of the system. Workspace roles and meeting roles are independent: the same person can be a member of a workspace and the host of a meeting in one of its channels.

TABLE: Table 3.1. Actors of the system
| Actor | Description |
| --- | --- |
| Guest | Not signed in; can view the landing page, register, sign in and open an invitation link |
| Member | Belongs to one or more workspaces; sends messages and joins voice/video channels |
| Admin | A member who manages channels, members and invitations of a workspace |
| Owner | The creator of a workspace; full control, changes roles, transfers ownership, archives |
| Host / co-host | Roles inside one meeting session; moderate the room |

### Functional requirements

Table 3.2 lists the functional requirements, grouped by feature. F1–F7 are the user-facing functions; F8 supports the evaluation in Chapter 5.

TABLE: Table 3.2. Functional requirements
| ID | Group | Requirement |
| --- | --- | --- |
| F1 | Account | Register with e-mail OTP verification, sign in with password or Google, refresh sessions, reset password |
| F2 | Workspace | Create workspaces; invite members by link or e-mail; owner/admin/member roles; archive and restore |
| F3 | Channel | Text, voice and video channels; private channels with a member list; channel ordering |
| F4 | Messaging | Send, edit and delete messages; threaded replies, mentions, reactions, pins, bookmarks, attachments, search |
| F5 | Presence | Online/offline status, typing indicators and unread counters in real time |
| F6 | Conferencing | Join and leave a video channel; microphone and camera control; screen sharing; dynamic video grid |
| F7 | Moderation | Waiting room, room lock, admit, remove, mute others, raise hand, end the meeting |
| F8 | Measurement | Display and export call QoS (RTT, jitter, packet loss, bitrate) |

### Non-functional requirements

Table 3.3 states the non-functional requirements and how each of them is verified in Chapter 5.

TABLE: Table 3.3. Non-functional requirements
| Group | Requirement | Verification |
| --- | --- | --- |
| Latency | Messages reach receivers in < 100 ms (95th percentile) on a local network | Load test with 50/100/200 connections (Section 5.3) |
| Media scalability | Client uplink and CPU do not grow with the number of participants | Mesh/SFU experiment (Section 5.4) |
| Media quality | Packet loss ≈ 0, jitter < 30 ms, RTT < 150 ms on a good network | `getStats()` measurements (Section 5.4) |
| Reliability | No lost or duplicated messages after lost acknowledgements or reconnection; automatic ICE recovery | Integration tests (Section 5.2) |
| Security | Hashed passwords, short-lived tokens, per-event authorisation, DTLS-SRTP | Permission tests (Section 5.2) |
| Horizontal scaling | Several API processes; meetings placed on workers/nodes | Two-process integration test (Section 5.2) |

### Main use cases

Figure 3.1 shows the main use cases grouped by actor. Members work inside workspaces and channels; owners and admins manage the workspace; hosts and co-hosts moderate a meeting.

FIG: fig-3-1-usecases.png | Figure 3.1. Main use cases of the system | 15.5

## System block diagram

### Overview

Figure 3.2 is the block diagram of the system. It consists of three main blocks (the client, the application and signalling server, and the SFU media server) and two supporting blocks (the data block and the network traversal block).

FIG: fig-3-2-block-diagram.png | Figure 3.2. System block diagram | 16

- The **client block** is a React single-page application running in the browser. It opens one Socket.IO connection for messaging and presence, uses REST for data that is loaded on demand, and opens two WebRTC transports (send and receive) when the user joins a video channel.
- The **application and signalling server block** is a Node.js process that exposes the REST API and the Socket.IO gateway. Every request and every event goes through authentication and authorisation before it reaches the chat, meeting or task services. The room manager in this block controls the media workers.
- The **SFU media block** is a pool of mediasoup C++ workers. Each meeting is a router placed on one worker; media flows directly between the browser and the worker.
- The **data block** is PostgreSQL. Besides business data, it stores presence with a TTL and forwards Socket.IO events between application processes.
- The **network traversal block** is a coturn STUN/TURN server used when a direct UDP path between a browser and the SFU is impossible.

### Control plane and data plane

The most important design decision is to separate the control plane from the media plane (Table 3.4). Messages, presence and signalling are small and go through the Node.js process; audio and video packets are large and never touch Node.js but go directly between the browser and a C++ worker. As a result the Node.js process only handles small messages, and Chapter 5 shows that its CPU usage stays at about 1% of one core or less while the workers forward media for ten participants.

TABLE: Table 3.4. Separation of control, media and data traffic
| Traffic | Protocol | Path |
| --- | --- | --- |
| Control (messages, presence, signalling) | Secure WebSocket (Socket.IO) | Browser ↔ Node.js API |
| Media | SRTP/SRTCP over UDP (fallback ICE-TCP, TURN) | Browser ↔ mediasoup worker |
| Persistent data | SQL | Node.js API ↔ PostgreSQL |

## Block analysis

### Client block

The client block has five components:

1. **Views** for the home page, workspaces, channels, chat, meetings, tasks, notifications, profile and administration. The layout has a navigation rail, a channel list and a content area; on phones the columns collapse into drawers.
2. **Application state and routing.** The current workspace, channel and meeting are encoded in the URL, so reloading the page, using back/forward or sharing a link always restores the right context.
3. **Real-time client.** A single `socket.io-client` connection authenticated with a short-lived access token. It receives messages, presence and meeting events and sends signalling requests with acknowledgements.
4. **Durable outbox and drafts.** Unconfirmed messages and drafts are stored in IndexedDB, so they survive a reload and can be resent with the same identifier.
5. **Media client.** `mediasoup-client` builds the WebRTC transports from server parameters, publishes the microphone, camera (as three simulcast layers) and screen, consumes remote tracks, collects QoS statistics and decides which layer each visible tile needs.

### Application and signalling server block

The server block runs on Node.js and contains:

1. **Authentication**: registration with e-mail OTP, password sign-in with salted scrypt hashes [@rfc7914], Google sign-in, short-lived JWT access tokens [@rfc7519] (15 minutes) and rotating refresh tokens stored in an HttpOnly cookie.
2. **REST API** for data loaded on demand: workspaces, channel history, files, search, notifications, tasks and administration.
3. **Socket.IO gateway** with two middleware layers: token verification on connection, and per-event rate limiting and authorisation before each handler.
4. **Domain services**: chat (messages, threads, mentions, notifications), workspaces and invitations, meeting sessions and moderation, tasks.
5. **Room manager**, which owns the pool of mediasoup workers, places each meeting on a worker and creates transports, producers and consumers on behalf of clients.

### SFU media block

The SFU block is a pool of mediasoup workers (two by default, at most eight). Each meeting is a router on exactly one worker, chosen as the worker with the fewest rooms. A router holds one send transport and one receive transport per participant, the producers that participants publish and the consumers that deliver remote tracks. The worker forwards RTP packets without decoding them, selects the simulcast layer for each consumer, retransmits lost packets on NACK and requests key frames when a consumer starts or changes layer. If a worker dies, only the meetings on that worker are closed; their participants are asked to rejoin and a replacement worker is created.

### Data block

PostgreSQL stores all business data (Section 3.4). It also plays two infrastructure roles. First, the Socket.IO PostgreSQL adapter uses `LISTEN/NOTIFY` [@postgres] to forward emitted events between API processes. Second, the `socket_presence` table stores one row per live socket with an expiry time renewed by a heartbeat, so presence is consistent across processes and stale rows of a crashed process expire automatically.

### Network traversal block

The coturn server provides STUN and TURN. The API generates time-limited TURN credentials for each transport, so a client can fall back to a relay when UDP is blocked or the NAT is symmetric. The SFU itself announces a public (or LAN) address and accepts both UDP and TCP.

## Database design

The PostgreSQL database contains 36 tables and views created by 20 versioned migrations. Table 3.5 groups the tables by domain, and Figure 3.3 shows the core entities of messaging and conferencing.

TABLE: Table 3.5. Database tables grouped by domain
| Domain | Main tables | Notes |
| --- | --- | --- |
| Identity | `users`, `refresh_sessions`, `email_otps`, `password_resets` | Salted password hashes; refresh tokens and OTP codes stored only as hashes |
| Organisation | `workspaces`, `memberships`, `channels`, `channel_memberships`, `workspace_invitations`, `audit_events` | Exactly one owner (unique index and constraint trigger); invitation tokens stored as SHA-256 |
| Communication | `messages`, `message_attachments`, `message_reactions`, `message_mentions`, `message_pins`, `message_bookmarks`, `thread_reads`, `notifications` | Unique client message identifier per author prevents duplicates |
| Conferencing | `meeting_sessions`, `meeting_attendees`, `meeting_connections`, `meeting_schedules` | At most one active session per channel (partial unique index) |
| Operations | `socket_presence`, `api_instances`, `request_rate_limits`, `schema_migrations` | Presence TTL, process leases, rate limits |
| Extension | `tasks` and related tables | Kanban board (not the focus of the thesis) |

FIG: fig-3-3-erd.png | Figure 3.3. Core entities of the database | 16

A database view, `channel_access`, joins memberships with channels (and with `channel_memberships` for private channels) and returns, for each user and channel, the role and whether the user can write (the workspace and channel are not archived). Every read or write permission check (REST, socket, search, file download and media) uses this single view, so the access policy is defined in exactly one place.

## Access control design

Table 3.6 and Table 3.7 define the permissions of the two role levels introduced in Section 2.5.

TABLE: Table 3.6. Workspace-level permissions
| Operation | Owner | Admin | Member | Note |
| --- | --- | --- | --- | --- |
| Read and send in public channels | ✓ | ✓ | ✓ | Workspace and channel not archived |
| Read and send in private channels | ✓* | ✓* | ✓* | *Requires channel membership, even for the owner |
| Create, edit and reorder channels | ✓ | ✓ | – | |
| Invite and revoke invitations | ✓ | ✓ | – | Seven-day tokens, stored only as hashes |
| Change roles, transfer ownership, archive | ✓ | – | – | Transaction with a workspace lock |
| Join video channels | ✓ | ✓ | ✓ | Per-session limits on users, tabs and sources |

TABLE: Table 3.7. Meeting-level permissions
| Operation | Host | Co-host | Member |
| --- | --- | --- | --- |
| Enable the waiting room, lock the room | ✓ | ✓ | – |
| Admit, remove, mute others | ✓ | ✓ | – |
| Appoint co-hosts, end the session | ✓ | – | – |
| Raise hand, control own devices | ✓ | ✓ | ✓ |

When a user loses access, the server emits `access_revoked`, disconnects all sockets of that user on every process and closes the user's media resources. The client then reconnects and reloads data with the new permissions.

## Real-time protocol design

### Event catalogue

The Socket.IO event contract is defined once as TypeScript types in a shared package and is used by both the client and the server, so a renamed event or a changed payload is a compile-time error on both sides. Table 3.8 summarises the events.

TABLE: Table 3.8. Socket.IO event catalogue
| Group | Client → server (with acknowledgement) | Server → client |
| --- | --- | --- |
| Channels | `join_channel`, `leave_channel`, `mark_channel_read` | `channel_read` |
| Messages | `send_message`, `edit_message`, `delete_message`, `react_message` | `new_message`, `message_changed` |
| Presence | `typing` | `user_typing`, `user_presence`, `online_users` |
| Meetings | `join_meeting`, `leave_meeting`, `meeting_state`, `meeting_action` | `meeting_state_changed`, `meeting_closed`, `meeting_mute` |
| SFU signalling | `create_webrtc_transport`, `connect_webrtc_transport`, `produce`, `consume`, `resume_consumer`, `pause_consumer`, `consumer_layer`, `close_producer`, `restart_ice` | `new_producer`, `producer_closed`, `peer_left` |

### Message delivery flow

The goal of the message protocol is that a message is never lost and never stored twice, even when acknowledgements are lost or the connection drops. Figure 3.4 shows the flow. The client assigns a `clientMessageId` and keeps the message in its outbox until it receives the acknowledgement. The server checks the current permission, takes a lock on (author, clientMessageId) and either inserts the message and broadcasts it, or, if the same identifier was already stored with the same content, returns the stored message without broadcasting it again. If the acknowledgement is lost, the client resends with the same identifier; after a reconnection it fetches the messages it missed through REST with an `after` cursor.

FIG: fig-3-4-seq-message.png | Figure 3.4. Sequence diagram of reliable message delivery | 16

### Joining a video channel

Figure 3.5 shows how a client joins a video channel. The server checks permissions, session limits and the waiting room, places the meeting on a worker, and returns the router's RTP capabilities. The client loads its mediasoup device, creates a send and a receive transport, publishes its tracks (the camera as three simulcast layers) and consumes the producers of the other participants. Consumers start paused and are resumed when the client is ready. Afterwards the client continuously tells the SFU which layer it needs for each tile, or pauses tiles that are not visible.

FIG: fig-3-5-seq-join.png | Figure 3.5. Sequence diagram of joining a video channel | 16

## Horizontal scaling design

Messaging and media scale differently, as illustrated in Figure 3.6. For messaging and presence, several API processes share PostgreSQL; the PostgreSQL adapter forwards emitted events between processes and the `socket_presence` table with a TTL and heartbeat gives a consistent view of who is online. Each process also renews a lease in `api_instances`, so the others can detect a dead process and clean up its meetings. Media cannot be shared in this way, because transports and routers live inside one worker process. A meeting therefore lives on **one** node and worker (room affinity): the session row records the media instance that owns the meeting, and clients ask the API for the media location before they open their media socket.

FIG: fig-3-6-scaling.png | Figure 3.6. Horizontal scaling: shared messaging, room affinity for media | 15

## User interface design

The interface follows a three-column layout: a navigation rail (home, groups, meetings, tasks, notifications, settings), a list of workspaces and channels, and a content area for chat or a meeting, with an optional information panel. The video grid computes the column count that gives the largest 16:9 tiles, paginates tiles (4, 6 or 9 per page depending on the width) and offers a focus mode with one large tile. Tiles outside the current page are not rendered and their video is paused at the SFU. The connection state is always visible: the channel header shows the number of online members or "reconnecting", and messages that could not be sent are shown with *retry* and *discard* actions. Screenshots of the implemented interface are presented in Section 4.5.

## Chapter summary

The system is organised as three main blocks (client, application/signalling server and SFU) and two supporting blocks (PostgreSQL and coturn). The control plane and the media plane are separated so that Node.js only handles small messages. A single database view defines access to channels, the message protocol combines client identifiers, an outbox and a uniqueness constraint to avoid loss and duplication, and meetings are pinned to one worker while messaging is shared between processes. Chapter 4 explains how these blocks are implemented.
