# THEORETICAL BACKGROUND

This chapter summarises only the theory that the project relies on: real-time communication on the web for messaging and presence, WebRTC for media, and the three architectures for multipoint conferencing. The comparison at the end of the chapter motivates the architecture of Chapter 3 and the experiments of Chapter 5.

## Real-time web communication

### From request–response to WebSocket

HTTP is a request–response protocol: the server only answers when the browser asks. To show a new message or a "typing" indicator as soon as it happens, older techniques simulate server push, each with its own limitation (Table 2.1).

TABLE: Table 2.1. Techniques for server-to-client push
| Technique | How it works | Limitation |
| --- | --- | --- |
| Short polling | The client asks periodically, e.g. every 2 s | Delay up to one polling period; many empty requests |
| Long polling | The server holds the request until data is available | One new HTTP round trip and full headers per event |
| Server-Sent Events | One-way HTTP stream from server to client | No client-to-server channel on the same connection |
| **WebSocket** | One long-lived, full-duplex TCP connection | Connection state, reconnection and scaling must be managed |

WebSocket [@rfc6455] starts with an HTTP/1.1 `Upgrade` handshake. The client sends a random `Sec-WebSocket-Key`; the server proves that it understands the protocol by returning the base64-encoded SHA-1 hash of that key concatenated with a fixed GUID, with status `101 Switching Protocols`. After the handshake the TCP connection carries WebSocket frames instead of HTTP. Each frame has a 2–14 byte header (FIN bit, opcode, mask bit and payload length); client-to-server frames are masked with a 32-bit key to protect intermediary caches, and ping/pong control frames detect dead connections. Because headers are sent only once, WebSocket is well suited to chat, typing and presence, which all need low-latency, two-way traffic. The system therefore uses WebSocket for every real-time interaction.

### Socket.IO

Socket.IO [@socketio] is a library on top of WebSocket that adds the features an application needs:

- **Named events with acknowledgements.** The server can return a result to exactly the request that emitted an event, through a callback passed to `socket.emit()`. The system uses acknowledgements for every write operation (sending a message, WebRTC signalling), so the client knows whether the operation succeeded.
- **Rooms.** The server groups sockets into rooms, for example per user (`user:<id>`) or per meeting (`meeting:<id>`), and emits events to a room. This is the mechanism used to deliver messages to the right audience.
- **Middleware.** Every connection must present an access token, and middleware can inspect every event before it reaches its handler.
- **Automatic reconnection and adapters.** When several server processes run, an adapter forwards `io.to(room).emit(...)` calls to the other processes, so a client connected to process A still receives events produced on process B.

### Presence synchronisation

Presence answers the question "who is online" over a constantly changing set of connections. Three difficulties must be handled: a user may have several connections (tabs, devices), so the user is offline only when the last connection closes; connections can die without notice (network loss, a killed server process), so each presence record needs a time-to-live (TTL) renewed by a heartbeat; and presence changes should only be sent to the users who share a workspace with that user, so the number of messages is proportional to the number of related users rather than to the whole system. Typing indicators are short-lived: the client sends `typing: true` when the user starts typing and `false` after a few seconds of inactivity; the server only forwards them.

## WebRTC

WebRTC [@webrtc] is a set of browser APIs and IETF protocols for sending audio, video and data between endpoints without plug-ins. The main APIs are `getUserMedia()`/`getDisplayMedia()` for capturing camera, microphone and screen, `RTCPeerConnection` for establishing a session, `RTCRtpSender`/`RTCRtpReceiver` for configuring encodings, and `getStats()` for standardised statistics [@webrtcstats], which are the source of the QoS measurements in Chapter 5. WebRTC deliberately does not define signalling: the application must exchange session descriptions itself. In this system signalling travels over Socket.IO.

### Session negotiation with SDP

A WebRTC session is described in SDP [@rfc8866] and negotiated with the offer/answer model [@rfc3264] as specified by JSEP [@rfc8829]. The description lists one media section per track, the codecs and their payload types (`a=rtpmap`), the ICE credentials and candidates, the DTLS certificate fingerprint, and options such as `a=group:BUNDLE` (all tracks share one transport), `a=rtcp-mux` (RTP and RTCP share one port) and `a=simulcast` (several encodings of one track). With the mediasoup SFU the browser does not negotiate with another browser: the `mediasoup-client` library builds the local SDP from parameters that the server sends through signalling (ICE parameters, candidates, DTLS parameters and RTP parameters), and the server never parses SDP text.

### NAT traversal: ICE, STUN and TURN

Most devices are behind NAT and have no public address. ICE [@rfc8445] solves this in three steps (Figure 2.1). First, each endpoint gathers **candidates**: *host* addresses of its own interfaces, *server-reflexive* addresses learned by asking a STUN server [@rfc8489], and *relay* addresses allocated on a TURN server [@rfc8656]. Second, the endpoints pair their candidates and run connectivity checks (STUN Binding requests) on each pair in priority order; host candidates have the highest priority and relay candidates the lowest, so ICE always prefers a direct path. Third, the controlling endpoint nominates one successful pair, and media flows on it. TURN relays all media and consumes server bandwidth, so it is only used when a direct path is impossible (symmetric NAT, UDP blocked).

FIG: fig-2-1-ice.png | Figure 2.1. ICE candidate types and connectivity paths between a browser and the SFU | 15

A media server with a fixed public address, such as mediasoup, runs **ICE-Lite**: it only announces its own host candidates and answers checks, while the browser controls the process. The server listens on both UDP and TCP, so media can still flow over ICE-TCP when UDP is blocked. To avoid distributing a permanent TURN password, the system uses time-limited TURN credentials [@turnrest]: the username is `<expiry timestamp>:<userId>` and the password is `base64(HMAC-SHA1(secret, username))`, which the TURN server (coturn) verifies with the same shared secret.

### Security: DTLS-SRTP

WebRTC mandates encryption. After ICE has found a path, the endpoints run a DTLS handshake (TLS over UDP) and compare the peer's certificate with the fingerprint received through signalling; since signalling runs over secure WebSocket, the fingerprint cannot be forged. Keys derived from DTLS [@rfc5764] are then used by SRTP [@rfc3711] to encrypt and authenticate every RTP and RTCP packet. With an SFU this protection is hop-by-hop (client ↔ SFU): the SFU decrypts packets to read RTP headers and re-encrypts them for each receiver.

### RTP, RTCP and QoS metrics

RTP [@rfc3550] carries media. Its 12-byte fixed header contains a payload type, a 16-bit **sequence number** (to detect loss and reordering), a 32-bit **timestamp** in codec clock units and a 32-bit **SSRC** that identifies the stream. RTCP is the companion control channel: Sender and Receiver Reports carry packet counts, cumulative loss, the highest sequence number and the interarrival jitter; feedback messages carry NACK (retransmission requests), PLI (requests for a new key frame) and transport-wide congestion control feedback. The QoS metrics used in this thesis are:

- **Jitter**, the variation of packet transit time. With `D(i−1,i) = (Rᵢ − Rᵢ₋₁) − (Sᵢ − Sᵢ₋₁)`, where R is the arrival time and S the RTP timestamp, the smoothed estimate is `Jᵢ = Jᵢ₋₁ + (|D(i−1,i)| − Jᵢ₋₁)/16`.
- **Round-trip time (RTT)**, measured from RTCP reports or, in the browser, from STUN checks on the selected ICE candidate pair.
- **Packet loss ratio** in a measurement window: `Δlost / (Δreceived + Δlost)`.
- **Jitter-buffer delay**, the average time a frame waits in the receive buffer before decoding, which is the main component of the end-to-end delay perceived by the user.

### Congestion control, simulcast and codecs

Network capacity is not constant, so the sender estimates it continuously. Chrome uses Google Congestion Control (GCC) [@gcc], which treats growing queuing delay as a sign of imminent congestion and reduces the bitrate, resolution or frame rate; the browser reports the reason in `qualityLimitationReason` (`bandwidth` or `cpu`). To serve receivers with different capacities, the sender can use **simulcast**: it encodes the same video several times at different resolutions, each with its own RTP stream, and the SFU forwards the version that suits each receiver at the cost of extra encoders and uplink on the sender. The system uses VP8 [@rfc6386] simulcast with three layers *q/h/f* (quarter, half and full resolution, at most 150/400/1200 kbps) and Opus [@rfc6716] for audio.

## Multipoint conferencing architectures

Consider a room with N participants, each sending one video stream of bitrate b. Figure 2.2 shows the three classical architectures.

FIG: fig-2-2-topologies.png | Figure 2.2. Mesh, MCU and SFU topologies for a room with four participants | 16

### Mesh

Every pair of participants has its own peer connection, N(N−1)/2 connections in total. Each client encodes its video N−1 times (one encoder per connection, because each connection runs its own congestion control), uploads N−1 streams and decodes N−1 streams. No media server is needed and the delay is minimal, but the uplink and CPU of every client grow linearly with N. Because the uplink is usually the weakest part of home and mobile networks, mesh is practical only for very small rooms.

### MCU

Each client sends one stream to a Multipoint Control Unit, which decodes all streams, mixes them into one composite picture and sound, and re-encodes the result for each participant. Clients send and receive only one stream, but the server spends a large amount of CPU on decoding, mixing and encoding, adds processing delay, imposes a fixed layout and reduces quality through transcoding.

### SFU

Each client sends one stream (or one simulcast group) to a Selective Forwarding Unit. The SFU does not decode media: it reads RTP headers and forwards each packet only to the receivers that need it, while handling RTCP feedback for each receiver. The client's uplink is independent of N, the server's CPU cost is low because it works at packet level, and each receiver can get a different quality layer. The client's downlink still grows with N−1, which can be reduced by selecting lower layers or pausing streams that are not displayed [@lastn].

### Quantitative comparison

Table 2.2 compares the per-client and server costs of the architectures.

TABLE: Table 2.2. Cost of the conferencing architectures for N participants
| Quantity (per client) | Mesh | MCU | SFU | SFU + simulcast |
| --- | --- | --- | --- | --- |
| Video encoders | N−1 | 1 | 1 | 3 (constant) |
| Uplink | (N−1)·b | b | b | b_q + b_h + b_f |
| Downlink | (N−1)·b | b_mix | (N−1)·b | sum of selected layers |
| Decoded streams | N−1 | 1 | N−1 | N−1 or number of visible tiles |
| Server CPU | none | very high | low | low |
| Added delay | none | decode + mix + encode | one forwarding hop | one forwarding hop |

For N = 6 and b = 1.2 Mbps, a mesh client would have to upload 5 × 1.2 = 6 Mbps with five encoders, whereas an SFU client with simulcast uploads at most 0.15 + 0.4 + 1.2 ≈ 1.75 Mbps with three encoders, independently of N. Previous studies of open-source SFUs [@andre2018] report the same qualitative behaviour. The project therefore chooses an **SFU**: client uplink and CPU stay constant as N grows, the server does not decode media, and simulcast combined with demand-driven layer selection also keeps the downlink under control. Chapter 5 verifies this choice experimentally against a mesh implementation on the same hardware.

## The mediasoup SFU

mediasoup [@mediasoup] is an SFU library for Node.js whose media core is written in C++ and runs in separate worker processes, while the control API is written in JavaScript/TypeScript. Its main concepts are listed in Table 2.3.

TABLE: Table 2.3. Main concepts of mediasoup
| Concept | Role |
| --- | --- |
| Worker | A C++ process that uses one CPU core; the application creates a pool of workers |
| Router | A media "room" with a common set of codecs; forwards packets from producers to consumers |
| WebRtcTransport | An ICE-Lite/DTLS/SRTP endpoint for one client (usually one for sending and one for receiving) |
| Producer | A track sent by a client (microphone, camera or screen) |
| Consumer | A track sent by the SFU to one client; can be paused, resumed and switched between simulcast layers |

The minimal signalling flow is: obtain the router's RTP capabilities, create two transports, connect them with the client's DTLS parameters, produce local tracks, and consume remote tracks. Consumers are created **paused** and resumed only when the client is ready, so the first key frame is not lost. mediasoup also sends probing packets on a dedicated stream (SSRC 1234) to discover spare bandwidth before switching a consumer to a higher layer; these packets must be excluded from client-side quality metrics (Section 5.4.2).

## Role-based access control

Role-based access control (RBAC) [@sandhu1996] assigns permissions to roles rather than to individual users. The system uses two levels of roles. At **workspace level**, the single *owner* has full control and can transfer ownership, *admins* manage members, channels and invitations, and *members* use the channels they are allowed to see; private channels add an explicit list of channel members. At **meeting level**, the *host* and *co-hosts* moderate the room (waiting room, lock, admit, remove, mute) and only the host can appoint co-hosts or end the meeting. Every socket event that writes data and every media signalling call is checked against the current role before it reaches its handler.

## Chapter summary

WebSocket and Socket.IO provide a two-way channel with acknowledgements, rooms and horizontal scaling through adapters, which is the basis for chat, typing, presence and signalling. WebRTC captures, encrypts and transports media and exposes standard statistics; ICE/STUN/TURN handle NAT traversal and RTP/RTCP carry media and quality feedback. Among the three conferencing architectures, the SFU gives the best balance between client load, server load and delay, and with simulcast it can control both uplink and downlink. These conclusions drive the design in Chapter 3.
