# CONCLUSION AND FUTURE WORK

## Achieved results against the objectives

Chapter 1 set four objectives. Table 6.1 restates each of them, summarises what was achieved and how it was verified, and states the level reached.

TABLE: Table 6.1. Objectives of Chapter 1 and the level achieved
| Objective | Result | Evidence | Level |
| --- | --- | --- | --- |
| O1 – Integrated workspace | A web application organised as Workspace → Channel with text, voice and video channels, private channels, invitations, roles, administration and audit, plus task board, notifications, search and profiles | Chapters 3–4; browser acceptance tests; Figures 4.6–4.10 | Achieved |
| O2 – Real-time messaging and presence | Idempotent delivery (client identifier, IndexedDB outbox, advisory lock and unique constraint), backfill after reconnection, presence with TTL across processes, typing indicators | Section 5.2; Section 5.3: 0 lost and 0 duplicated messages, p95 receipt latency ≤ 46 ms at 200 sockets | Achieved on a single machine; not yet measured on a wide-area network |
| O3 – Multipoint video conferencing | mediasoup SFU with a worker pool, three-layer simulcast, demand-driven layers and pausing, ICE recovery, time-limited TURN credentials, waiting room and moderation | Section 5.4: @O3_EVIDENCE@ | Achieved in the laboratory; multi-network and TURN tests remain |
| O4 – Quantitative evaluation | Media laboratory with real browsers, repeated runs and raw data; load test of the messaging core; comparison with a mesh baseline | Chapter 5, raw data in `docs/evidence/` | Achieved for a single host; packet-level capture and multi-host runs remain |

The central technical claim of the thesis, that an SFU keeps the cost of each participant independent of the size of the room while a mesh does not, was confirmed experimentally on the same hardware. @O3_SUMMARY@

## Contributions

The main contributions of the project are:

1. A working, self-hostable collaboration platform that integrates persistent channel messaging and multipoint conferencing in one browser application, with a shared permission model enforced on every REST request and every socket event.
2. A message delivery protocol that combines client-generated identifiers, a durable outbox, a transaction-scoped advisory lock and a uniqueness constraint to obtain exactly-once storage on top of at-least-once delivery, verified under lost acknowledgements, concurrent retries and reconnections.
3. A demand-driven video grid that derives the simulcast layer of every consumer from the size of its tile and pauses consumers that are not displayed, so that the downlink follows what the user sees rather than the size of the room.
4. A reproducible media laboratory that runs every participant as a real browser, compares the SFU with a mesh baseline under identical conditions, repeats each level and keeps all raw samples, together with documented measurement pitfalls (loopback announcement and probation packets) that would otherwise bias the results.

## Limitations

- All media and messaging measurements were taken on one machine over the loopback path of its LAN address. They show trends and relative costs reliably, but they do not measure behaviour under real network delay, loss or bandwidth limits.
- No packet capture was made, so DTLS-SRTP and RTCP behaviour is supported by the specifications and by `getStats()` but not by packet-level evidence.
- The synthetic camera produces simple content; real cameras would produce higher bitrates, and the rendering cost of video was excluded from the CPU measurements.
- Multi-node deployment of the SFU, TURN on a public server, production e-mail delivery, cloud storage, remote continuous integration and production backups have been implemented or configured but not validated on real infrastructure. The system is therefore not claimed to be production-ready.
- There are no native mobile applications, no recording and no end-to-end encryption through the SFU.

## Future work

1. **Multi-network evaluation.** Repeat the media experiments with clients on several machines and networks, including a client that must use TURN, and with controlled impairment (loss, delay, bandwidth limits) at a router; capture packets with Wireshark to analyse STUN, DTLS, RTP and RTCP (SR/RR, NACK, PLI) and to cross-check `getStats()`.
2. **Adaptive topology for small rooms.** Use a single encoding or peer-to-peer media for two-person calls, where simulcast costs more uplink than it saves, and switch to the SFU when a third participant joins.
3. **Active-speaker selection.** Combine the demand-driven grid with audio-level based selection of the forwarded streams (in the spirit of Last N [@lastn]) for large rooms.
4. **Scaling the media plane.** Pipe routers between workers and nodes so that a very large meeting can span several workers, and validate the multi-node deployment with load balancing on real servers.
5. **Product features.** Direct messages, recording, end-to-end encryption with insertable streams, and native or progressive mobile applications.

In conclusion, the thesis delivered an integrated real-time workspace with in-browser multipoint conferencing and showed, with reproducible measurements, that its SFU-based media architecture scales where the peer-to-peer baseline does not. The remaining work is mainly to extend the evaluation from one machine to real networks and real infrastructure.
