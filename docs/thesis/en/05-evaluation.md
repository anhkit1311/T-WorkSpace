# EXPERIMENTS AND EVALUATION

This chapter evaluates the system against the requirements of Section 3.1.3. It first describes the test bed, the metrics and the baseline system (Section 5.1), then reports functional and reliability tests (Section 5.2), the latency of the messaging core under load (Section 5.3) and the main experiment, which compares the SFU of the system with a full-mesh baseline (Section 5.4). Section 5.5 compares the system with existing platforms, Section 5.6 checks the requirements and Section 5.7 discusses the limitations of the measurements. All numbers come from raw data stored in the repository under `docs/evidence/`; values that were derived from the raw data (for example totals or ratios) are marked as *computed*.

## Experimental setup

### Test bed and scale

All experiments were run on one development machine (Table 5.1). Figure 5.1 shows how the media experiments are organised: a harness written in Node.js starts every participant as a **separate headless Chrome process** with a synthetic camera and microphone, joins it to a room, and samples its WebRTC statistics and CPU usage through the Chrome DevTools Protocol. Up to ten browsers ran at the same time for the media experiments, and up to 200 Socket.IO clients for the messaging experiment.

TABLE: Table 5.1. Test environment
| Component | Value |
| --- | --- |
| Hardware | AMD Ryzen 7 6800HS, 8 cores / 16 threads, 23.3 GiB RAM |
| Operating system | Windows 11 (x64) |
| Software | Node.js 22.19, PostgreSQL 17.11 (Docker), Google Chrome (headless), mediasoup 3 |
| Media source | Chromium synthetic camera, 960×540 requested at 30 fps (delivers 20 fps), VP8 and Opus |
| Network | All browsers, the API and the SFU on the same host; media sent to the host's LAN address over UDP |
| Scale | Media: 2–10 browsers per room. Messaging: 50, 100 and 200 sockets on two API processes |

FIG: fig-5-1-testbed.png | Figure 5.1. Test bed of the media experiments | 16

Running everything on one host has a consequence that is used throughout this chapter: the network path adds no real delay, loss or bandwidth limit, so RTT, jitter and loss reflect **processing load**, not network quality, and when the total CPU demand approaches the capacity of the machine every metric degrades because of contention. Section 5.7 discusses this limitation.

### Metrics

The media metrics are read from `getStats()` every 2 seconds and follow the definitions of Section 2.2.4 and Section 4.4.2:

- **Uplink and downlink** (kbps): change in bytes (payload and RTP headers) over the change in time.
- **Client CPU** (%): total CPU time of all processes of one browser instance; 100% equals one core.
- **RTT** (ms) of the selected ICE candidate pair; **audio and video jitter** (ms); **packet loss** (%) per window.
- **Received frame rate**, **jitter-buffer delay**, **freeze count** and the number of **active encoders** (outgoing video streams above 1 kbps).
- **Server CPU**: CPU of the mediasoup worker and of the Node.js process.

Each level of N is measured for 60 seconds after a 30-second warm-up that lets the bandwidth estimator settle, which gives 30 samples per client. The media levels were repeated **three times**; tables report the mean over runs and, where several runs exist, the sample standard deviation across runs (± SD). Message latency is reported as nearest-rank percentiles p50, p95 and p99 over all samples.

### Baseline system

The guidelines of the faculty ask for an established reference system to compare against. For the media core, the reference is a **full-mesh peer-to-peer** implementation, the architecture that a small WebRTC application uses when it has no media server (Section 2.3.1). Implementing the baseline inside the same laboratory makes the comparison fair: both architectures use the same browser, the same synthetic source, the same codec, the same machine and the same measurement code, and differ only in the topology. The mesh client opens one `RTCPeerConnection` per pair of participants through a minimal signalling relay and sends one encoding with at most 1,200 kbps per connection; the SFU client is the production `MediasoupClientService` of nexo with three simulcast layers and the default layer policy. Section 5.5 additionally compares nexo qualitatively with existing products.

## Functional and reliability testing

Table 5.2 summarises the automated tests. The integration suites run against a real PostgreSQL database and real mediasoup workers.

TABLE: Table 5.2. Automated test suites
@TESTS_TABLE@

The tests verify the reliability properties required in Section 3.1.3:

- **Message idempotency.** Six concurrent requests with the same `clientMessageId` create exactly one row; dropping the acknowledgement and resending produces exactly one `new_message` broadcast; pagination with the `after` cursor never returns a message twice.
- **Revocation.** After access to a private channel is revoked, both retries and backfill after reconnection are rejected.
- **Administration.** Permissions are checked across REST, socket, search, file download, schedules and media; invitations with a wrong e-mail, expired, revoked or accepted concurrently are handled; ownership transfer works and the database refuses to delete the only owner.
- **Search.** Vietnamese text, the characters `%` and `_`, and opening a message outside the latest 100 messages are tested; a query plan on 10,000 messages confirmed that the existing timeline index is sufficient at this scale.
- **Meetings.** Waiting room, lock, removal, end and the limits on users and tabs are tested, and all four microphone/camera combinations are checked to make sure a disabled source is never published.
- **Fault tolerance.** With two workers, killing one worker does not affect participants on the other worker, and the next join creates a replacement worker.
- **Two API processes.** With the PostgreSQL adapter, messages, tasks and notifications cross processes, and revocation takes effect on both.
- **Migrations and recovery.** The 20 migrations are checksummed; two runners started at the same time on one database do not conflict; a backup restored into a fresh database preserves the schema and Unicode data.

These tests establish the correctness of control traffic and permissions; they do not measure RTP quality, which is the subject of Section 5.4.

## Messaging latency under load

### Scenario

Two API processes shared PostgreSQL through the PostgreSQL adapter (pool of eight connections per process); four workspaces with two text channels each were created. Each level (50, 100 and 200 sockets) ran for 30 seconds and was repeated twice, with **4 messages per second in total** sent by four concurrent senders. In every run the acknowledgement was dropped on purpose six times and the message was resent with the same identifier, and two messages were sent while one client was offline to exercise backfill. Most sockets are receivers, so the scenario models a busy channel rather than 200 users all typing at the same time.

### Results

Table 5.3 and Figure 5.2 show the latencies. *ACK* is the time from emitting a message to the successful acknowledgement; *receipt* is the time from emitting a message to the moment each receiver gets `new_message`, weighted by the number of receivers.

TABLE: Table 5.3. Message latency in milliseconds (two runs per level)
| Sockets | ACK p50 / p95 / p99 | Receipt p50 / p95 / p99 | Unique messages / receipts | Errors / duplicates |
| --- | --- | --- | --- | --- |
| 50 | 24.99 / 39.88 / 53.79 | 25.01 / 32.23 / 47.02 | 244 / 3,052 | 0 / 0 |
| 100 | 23.69 / 46.09 / 56.81 | 23.78 / 34.87 / 48.07 | 244 / 6,096 | 0 / 0 |
| 200 | 25.23 / 48.58 / 140.26 | 25.38 / 45.93 / 137.86 | 244 / 12,196 | 0 / 0 |

FIG: fig-5-2-chat.png | Figure 5.2. Receipt latency percentiles at 50, 100 and 200 sockets | 15

In total 732 messages produced 21,344 receipts, and the number of stored rows equalled the number of unique messages in every run: **no message was lost or duplicated**, although 36 sends were retried after a lost acknowledgement and six clients reconnected. Each reconnection recovered the two missed messages through REST in 21.5–54.9 ms. The median latency stayed almost constant (23.7–25.4 ms) while the number of sockets grew fourfold; the 95th percentile grew from 32 to 46 ms, and only the 99th percentile at 200 sockets rose to about 140 ms.

Table 5.4 shows the resources used. Each API process used less than 6% of one core and less than 120 MiB of memory. The number of requests waiting for a database connection grew with the number of sockets (13, 31 and 120) but appeared only during the initial burst of connections and disappeared in later samples. The burst of connections and the presence updates that accompany it are therefore the first point to optimise before increasing the load, rather than simply enlarging the pool.

TABLE: Table 5.4. Resources during the messaging load test (maximum observed)
| Sockets | RSS per API (MiB) | CPU per API (% of one core) | Max waiting pool requests | PostgreSQL CPU / memory |
| --- | --- | --- | --- | --- |
| 50 | 98.8 | 5.60 | 13 | 5.1–5.2% / 107–112 MiB |
| 100 | 95.7 | 3.75 | 31 | 5.0–6.0% / 111–113 MiB |
| 200 | 115.2 | 4.66 | 120 | 4.8–5.6% / 112–113 MiB |

## Mesh versus SFU

This is the main experiment of the thesis. It checks the architectural choice of Section 2.3.4: as the number of participants N grows, which architecture keeps the quality of the call at an acceptable cost?

### Experiment design

Table 5.5 summarises the configuration of the two architectures. Both are measured with the same procedure: the harness creates fresh test users and a test workspace for each level, starts N browsers, waits 30 seconds, measures for 60 seconds and removes the fixtures. Each architecture was measured three times at every level; the mesh runs stop at N = 8 because the machine was already saturated at N = 6, while the SFU runs go up to N = 10. Two additional SFU configurations isolate the effect of simulcast: a single encoding instead of three layers, and all consumers forced to the lowest layer.

TABLE: Table 5.5. Configuration of the compared architectures
| Item | Mesh baseline | SFU (nexo) |
| --- | --- | --- |
| Topology | One RTCPeerConnection per pair, minimal signalling relay | Real API and mediasoup worker; production client code |
| Video encoding | One encoding, at most 1,200 kbps per connection | Simulcast q/h/f = 150/400/1,200 kbps |
| Receive layer | – | Default policy: more than 6 cameras → layer 0, more than 2 → layer 1, otherwise layer 2 |
| Source | 960×540 synthetic camera, 20 fps, VP8; Opus audio | Same |
| Rendering of received video | Off (decoded, not drawn) | Off |
| Levels of N | 2, 4, 6, 8 | 2, 4, 6, 8, 10 |
| Repetitions | 3 runs × 60 s per level (30 s warm-up) | 3 runs × 60 s per level (30 s warm-up) |

Received video is decoded but not drawn. In headless mode the browser draws video in software, which costs about one core per client and would hide the transport and codec costs that are being compared; the drawing cost is the same for both architectures for the same number of tiles, and on a real device it is done by the GPU.

### Measurement pitfalls

Two effects would have biased the comparison if they had not been found and removed.

**Loopback announcement.** When the SFU announced `127.0.0.1`, the browser did not gather a loopback candidate, the UDP connectivity check failed and ICE fell back to mediasoup's passive TCP candidate. RTP over TCP suffers from head-of-line blocking, which produced frequent NACKs and high jitter without any real loss. The harness therefore announces the LAN address of the machine, and all SFU results below use UDP (the selected candidate pair is recorded with every sample). The development configuration of the application must use the LAN address for the same reason.

**Probation packets.** mediasoup sends padding on a dedicated stream (SSRC 1234) to probe for spare bandwidth before raising a consumer's layer. This stream shows artificial "loss" and jitter of about 200 ms, while the real media streams have zero loss and near-zero jitter; the consumer statistics on the SFU also report zero loss and zero NACK. Its bytes are counted in the downlink, because they do cross the network, but it is excluded from the quality metrics. Without this correction the SFU would have appeared worse than the mesh.

### Results: bandwidth

Table 5.6 and Table 5.7 give the results of the two architectures, and Figures 5.3 to 5.7 plot the main metrics against N with error bars of one standard deviation across runs.

MEDIATABLE: mesh-norender | Table 5.6. Results of the mesh baseline (mean ± SD over runs)

MEDIATABLE: sfu-norender | Table 5.7. Results of the SFU with simulcast (mean ± SD over runs)

FIG: fig-5-3-uplink.png | Figure 5.3. Uplink per client against the number of participants | 15

Figure 5.3 shows the main result. The mesh uplink grows with the number of connections: each connection carries about {{=mesh:2:upKbps}} kbps, so a client uploads {{mesh:2:upKbps}} kbps at N = 2 and {{mesh:4:upKbps}} kbps at N = 4 with three encoders, exactly the (N−1)·b of Table 2.2. The SFU uplink is flat: {{sfu:2:upKbps}} kbps at N = 2 and {{sfu:10:upKbps}} kbps at N = 10, always with three encoders (the simulcast layers). At N = 2 the SFU client uploads more than the mesh client because it sends three layers instead of one; this fixed cost of simulcast is the price paid for flatness. From the mesh data, two connections at N = 3 would need about @MESH_N3@ kbps (*computed* by linear extrapolation, not measured), so the break-even point is around N = 3, and from N = 4 the SFU uploads @UP_SAVING_4@% less than the mesh (*computed*).

The mesh values at N = 6 and 8 do not reflect the theoretical demand (five and seven streams, about @MESH_N6_THEORY@ and @MESH_N8_THEORY@ kbps, *computed*): the number of encoders that were actually sending dropped to {{=mesh:6:encoders}} and {{=mesh:8:encoders}} on average because connections stalled, and the variation between runs is very large. This is an overload state, not a steady state.

FIG: fig-5-4-downlink.png | Figure 5.4. Downlink per client against the number of participants | 15

Figure 5.4 shows the downlink. In the mesh, every received stream costs about {{=mesh:2:downKbps}} kbps and the total grows with N−1. In the SFU, the downlink follows the layer policy rather than N: one stream on layer 2 costs {{=sfu:2:downKbps}} kbps at N = 2; at N = 4 and 6 the consumers move to layer 1 and each stream costs about @SFU_PER_STREAM_L1@ kbps (*computed*); above six cameras they move to layer 0, so the downlink at N = 8 ({{=sfu:8:downKbps}} kbps for seven streams) is lower than at N = 6, and at N = 10 nine streams cost {{=sfu:10:downKbps}} kbps. The downlink of an SFU client therefore stays bounded even as the room grows, which is the purpose of simulcast and of the layer policy.

### Results: CPU

FIG: fig-5-5-cpu.png | Figure 5.5. Browser CPU per client against the number of participants | 15

Figure 5.5 compares the CPU of one browser. In the mesh, CPU grows from {{mesh:2:cpu}}% to {{mesh:4:cpu}}% of one core when N goes from 2 to 4, about @MESH_CPU_RATIO@ times (*computed*), in line with the number of encoders and decoders per client growing from one to three. At N = 6 a mesh browser used {{=mesh:6:cpu}}% on average, i.e. more than two cores, far beyond what a typical user device can spend on a call. In the SFU, CPU grows slowly from {{sfu:2:cpu}}% at N = 2 to {{sfu:10:cpu}}% at N = 10, because the number of encoders is fixed and only the decoders grow; at N = 4 the SFU client uses @CPU_SAVING_4@% less CPU than the mesh client (*computed*).

Table 5.8 shows the cost moved to the server. The mediasoup worker used {{=sfu:2:workerCpu}}% of one core at N = 2 and {{=sfu:10:workerCpu}}% at N = 10; it grows faster than linearly because the number of forwarded streams grows with N(N−1). The Node.js process, which carries signalling and the API, stayed between {{=sfu:2:nodeCpu}}% and {{=sfu:10:nodeCpu}}% of one core with {{=sfu:2:rss}}–{{=sfu:10:rss}} MiB of memory, which confirms the separation of control and media planes of Section 3.2.2: Node.js never touches media packets.

SERVERTABLE: sfu-norender | Table 5.8. Server-side cost of the SFU (mean over runs)

Summing the CPU of all browsers gives the total load of the experiment (*computed* as N × mean client CPU): @TOTAL_CPU@. The mesh at N = 6 and 8 used most of the 16 hardware threads of the machine; part of its collapse is therefore caused by the test machine itself, a point discussed in Section 5.7.

### Results: delay and quality

FIG: fig-5-6-rtt.png | Figure 5.6. Round-trip time against the number of participants (logarithmic scale) | 15

FIG: fig-5-7-fps.png | Figure 5.7. Received frame rate against the number of participants | 15

Figure 5.6 and Figure 5.7 show the delay and the frame rate. With the SFU, RTT stayed between {{=sfu:2:rtt}} and {{=sfu:10:rtt}} ms, video jitter at most {{=sfu:10:videoJitter}} ms, audio jitter at most @SFU_MAX_AJIT@ ms, packet loss {{=sfu:10:loss}}% and NACK rate zero at every level, and from N = 4 upwards the received frame rate stayed at {{=sfu:4:fps}} fps, the rate of the source. N = 2 is the exception, with an average of {{sfu:2:fps}} fps: in every run at least one of the two receivers spent part of the window (7 to 20 of its 30 samples) below 18 fps, down to 5 fps, and the downlink was correspondingly lower and more variable. This is most likely the bandwidth estimate still rising towards the full-resolution layer, which the policy selects when there is only one remote camera and which needs the largest bitrate; it did not occur at any larger N, where lower layers are used. Holding a single-camera room on layer 1 until the estimate is sufficient would remove this effect. No video freeze occurred during the measurement windows of the SFU runs; the few freezes counted while the room was filling up correspond to layer switches when the room grew beyond six cameras.

The mesh reached similar quality at N = 2 and 4 (RTT about 1 ms, no loss, 20 fps) but **collapsed at N = 6**: RTT rose to {{mesh:6:rtt}} ms, the jitter buffer held {{mesh:6:jitterBuffer}} ms of media, the received frame rate fell to {{mesh:6:fps}} fps, audio jitter reached {{=mesh:6:audioJitter}} ms, each client saw @MESH_FREEZE_6@ video freezes per minute, and the browser reported its sending quality as limited by bandwidth or CPU during @MESH_LIMITED_6@% of the samples. At N = 8 one of the three runs could not even be completed because the browsers stopped responding to the harness, and the completed runs show RTTs of several seconds. The first frame appeared after {{=mesh:2:firstFrame}} ms at N = 2 and {{=mesh:8:firstFrame}} ms at N = 8 in the mesh, against {{=sfu:2:firstFrame}}–{{=sfu:10:firstFrame}} ms in the SFU; with the SFU this time includes the sequential join of all participants through the API.

### Effect of simulcast and layer selection

Table 5.9 and Figure 5.8 isolate the contribution of simulcast and of the layer policy. With a **single encoding**, the SFU client uploads only {{=sfu-nosimulcast-norender:2:upKbps}} kbps at N = 2, the same as a mesh client, but every receiver gets the full-resolution stream, so the downlink grows linearly to {{=sfu-nosimulcast-norender:8:downKbps}} kbps at N = 8, @SINGLE_VS_SIM_8@ times the downlink of the simulcast configuration at the same N (*computed*), and the client CPU rises to {{=sfu-nosimulcast-norender:8:cpu}}% because every stream is decoded at full resolution. Simulcast therefore trades a fixed uplink cost for a bounded downlink and decoding cost. Forcing **all consumers onto layer 0** lowers the downlink at N = 6 from {{=sfu:6:downKbps}} kbps (layer 1 under the default policy) to {{=sfu-layer0-norender:6:downKbps}} kbps, @L0_SAVING_6@% less (*computed*); at N = 10 the default policy already selects layer 0, so both configurations give about the same downlink ({{=sfu:10:downKbps}} and {{=sfu-layer0-norender:10:downKbps}} kbps). The demand-driven grid of Section 4.4.3 refines this policy per tile in the real interface, pausing tiles that are off-page and requesting larger layers only for large tiles.

VARIANTTABLE: Table 5.9. SFU variants: simulcast with the default policy, single encoding, and layer 0 forced (mean over runs)

FIG: fig-5-8-layers.png | Figure 5.8. Downlink per client for the three SFU configurations at N = 6 and N = 10 (single encoding was measured up to N = 8) | 14

### Discussion

1. **The mesh collapses between N = 4 and N = 6, while the SFU shows no sign of degradation up to N = 10.** This matches Table 2.2: the mesh costs grow linearly with N−1 in uplink, downlink and CPU, while the SFU keeps the uplink constant and lets the downlink be controlled by the layer policy.
2. **The SFU is not cheaper at every N.** At N = 2, simulcast costs more uplink than a mesh connection. A single encoding, or peer-to-peer media for two-person calls, would be the better choice there; automatic switching is not implemented.
3. **The measured SFU uplink (about 1.0 Mbps) is lower than the 1.75 Mbps of the example in Section 2.3.4.** That figure is the sum of the maximum bitrates of the three layers. With the simple synthetic content at 960×540 and 20 fps the encoder does not use the full budget; real cameras would push the uplink closer to the ceiling. The result that matters is that the uplink does **not** depend on N.
4. **The cost moves to the server.** The SFU's outgoing bandwidth is the sum of the downlinks of all clients (about @SFU_EGRESS_10@ Mbps at N = 10, *computed*), and the worker's CPU grows faster than linearly with N. An SFU server must be provisioned for this bandwidth, a cost that a mesh does not have.

## Comparison with existing systems

Besides the measured mesh baseline, Table 5.10 places nexo among well-known platforms. Persistent channels with integrated voice and video are the model of Discord and Slack [@discord], [@slack]; dedicated meeting products such as Jitsi Meet [@jitsi] focus on the meeting itself. Like Jitsi Videobridge and Discord's media servers, nexo uses a selective forwarding unit, which is the architecture that open-source SFU studies [@andre2018] and the results above identify as the scalable choice for multi-party calls. Jitsi's Last N [@lastn] forwards only the most recently active speakers; nexo instead derives the forwarded streams and their layers from the tiles that are actually visible, a complementary policy that could be combined with speaker activity in future work.

TABLE: Table 5.10. Qualitative comparison with existing platforms
| Feature | nexo | Discord | Slack | Jitsi Meet |
| --- | --- | --- | --- | --- |
| Workspaces with persistent text channels | ✓ | ✓ | ✓ | – |
| Video calls inside the workspace | ✓ (video channels) | ✓ (voice/video channels) | ✓ (huddles) | – (separate meetings) |
| Media architecture | SFU (mediasoup) | SFU (own servers) | Proprietary | SFU (Jitsi Videobridge) |
| Self-hosted, source available | ✓ | – | – | ✓ |
| Waiting room and host moderation | ✓ | Partial | Partial | ✓ |
| Task board linked to messages | ✓ | – | Via integrations | – |

The comparison is qualitative: the commercial platforms run on global infrastructure that cannot be reproduced on one machine, so no performance comparison with them is claimed.

## Requirement verification

Table 5.11 checks the non-functional requirements of Table 3.3 against the measurements.

TABLE: Table 5.11. Verification of the non-functional requirements
| Requirement | Measured result | Assessment |
| --- | --- | --- |
| Messages delivered in < 100 ms (p95) on a local network | Receipt p95 32.2 / 34.9 / 45.9 ms at 50 / 100 / 200 sockets; ACK p95 at most 48.6 ms; p99 at 200 sockets about 140 ms | **Met** for p95 on one host; the p99 tail at 200 sockets exceeds 100 ms |
| Client uplink and CPU do not grow with N (SFU) | Uplink {{=sfu:2:upKbps}} → {{=sfu:10:upKbps}} kbps for N = 2 → 10; CPU {{=sfu:2:cpu}}% → {{=sfu:10:cpu}}% | **Met for uplink**; CPU grows slowly with the number of decoded streams, far below the linear growth of the mesh |
| Loss ≈ 0, jitter < 30 ms, RTT < 150 ms on a good network | SFU: loss 0%, video jitter ≤ {{=sfu:10:videoJitter}} ms, audio jitter ≤ @SFU_MAX_AJIT@ ms, RTT ≤ {{=sfu:10:rtt}} ms up to N = 10 | **Met** on the loopback path; not yet measured on real networks |
| No loss or duplication after lost ACKs or reconnection; ICE recovery | 0 lost, 0 duplicated in 732 messages with 36 retries and 6 reconnections; ICE restart implemented and tested at signalling level | **Met** in the tested scenarios |
| Hashed passwords, short-lived tokens, per-event authorisation, DTLS-SRTP | Cross-permission tests pass; DTLS-SRTP is mandatory in WebRTC | **Met** for authorisation; no packet capture yet to show DTLS-SRTP on the wire |
| Several API processes; meetings placed on workers | Two API processes and a killed worker in integration tests | **Met** for several processes and workers on one host; multi-node SFU not validated |

## Limitations of the measurements

The following limitations define what may be concluded from this chapter.

1. **One machine.** All browsers, the API, PostgreSQL and the SFU shared 16 hardware threads. When the total CPU demand approached the capacity of the machine, every metric degraded because of contention. The mesh at N = 6 and 8 was in this state, so part of its collapse comes from the test machine; on real devices each participant has its own CPU, and the breaking point of a mesh is set by the uplink or the CPU of the weakest device, which may lie at a different N. The robust conclusions are the trends (linear growth for the mesh, flat uplink for the SFU), not the exact breaking point.
2. **Loopback network.** There is no real loss, delay or bandwidth limit, so RTT, jitter and loss reflect processing load rather than network quality. Multi-network tests, TURN and controlled impairment were not performed.
3. **Synthetic media and no rendering.** The synthetic camera produces simple content and therefore lower bitrates than a real camera, and the cost of drawing video was excluded. Real CPU usage would be higher by about the same amount for both architectures.
4. **Three runs per level.** Standard deviations are based on three runs per level (two for the mesh at N = 8, where one run could not be completed), which is enough to show trends but not to give tight confidence intervals.
5. **No packet capture.** The packet-capture analyser and procedure exist in the repository, but no capture was made, so there is no packet-level evidence for STUN, DTLS and RTP/RTCP.
6. **Moderate messaging load.** The messaging test used 4 messages per second; soak tests, saturation tests, long network outages and mobile networks were not simulated.
7. **Infrastructure not validated.** Remote CI, production backups, cloud S3 and e-mail, public HTTPS and a real TURN server were outside the tested environment, so the system is not claimed to be production-ready.

## Chapter summary

The automated tests confirmed the correctness of message idempotency, permissions, administration, worker fault tolerance, multi-process operation, migrations and recovery. The messaging core kept the 95th-percentile receipt latency below 46 ms with 200 sockets and lost or duplicated no message. In the main experiment, the SFU kept the client uplink at about 1 Mbps and the client CPU low from N = 2 to N = 10 with no packet loss and a stable 20 fps from N = 4 upwards, whereas the mesh baseline grew linearly and collapsed at N = 6 on the same machine. These results were obtained on one host over the loopback network; extending them to real networks is the main item of future work.
