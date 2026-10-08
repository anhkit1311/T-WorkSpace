@ABSTRACT

Remote teams, online classes and online communities usually split their work across several tools: a chat application for day-to-day discussion, a separate service for video meetings and another one for task tracking. Every switch between these tools breaks the context of the conversation. This thesis designs, implements and evaluates **nexo**, a browser-based collaborative workspace that combines channel-based real-time messaging, presence, multipoint video conferencing and lightweight task management in a single application organised as *Workspace → Channel*.

The system consists of a React/TypeScript single-page client, a Node.js application server that carries REST, Socket.IO messaging and WebRTC signalling, a mediasoup Selective Forwarding Unit (SFU) with a pool of C++ media workers, and a PostgreSQL database that also synchronises events and presence between application processes. Messages are delivered with an idempotent protocol (client-generated message identifiers, a durable client outbox and a database uniqueness constraint), so that lost acknowledgements and reconnections neither lose nor duplicate messages. The conferencing client uses three-layer VP8 simulcast and a dynamic video grid that only requests the layers it can actually display.

The system was evaluated with automated tests, a WebSocket load test and a media laboratory that runs every participant as a separate headless Chromium instance. With 200 concurrent sockets the 95th-percentile message delivery latency stayed below 50 ms with no lost or duplicated messages. Against a full-mesh peer-to-peer implementation used as the baseline on the same hardware, the SFU kept the per-client uplink almost constant as the room grew, while the mesh client's uplink and CPU grew linearly and the mesh session collapsed at six participants. All experiments ran on a single machine over the loopback network; multi-network, TURN and production-scale measurements remain future work.

**Keywords:** real-time collaboration, WebSocket, Socket.IO, WebRTC, SFU, mediasoup, simulcast, QoS.

@ABBREVIATIONS

| Abbreviation | Meaning |
| --- | --- |
| ACK | Acknowledgement |
| API | Application Programming Interface |
| CDP | Chrome DevTools Protocol |
| CPU | Central Processing Unit |
| DTLS | Datagram Transport Layer Security |
| FPS | Frames per second |
| GCC | Google Congestion Control |
| ICE | Interactive Connectivity Establishment |
| JWT | JSON Web Token |
| MCU | Multipoint Control Unit |
| NACK | Negative Acknowledgement |
| NAT | Network Address Translation |
| P2P | Peer-to-peer |
| PLI | Picture Loss Indication |
| QoS | Quality of Service |
| RBAC | Role-Based Access Control |
| REST | Representational State Transfer |
| RTCP | RTP Control Protocol |
| RTP | Real-time Transport Protocol |
| RTT | Round-trip time |
| SDP | Session Description Protocol |
| SFU | Selective Forwarding Unit |
| SPA | Single-Page Application |
| SRTP | Secure Real-time Transport Protocol |
| SSRC | Synchronisation Source identifier |
| STUN | Session Traversal Utilities for NAT |
| TTL | Time to live |
| TURN | Traversal Using Relays around NAT |
| UDP / TCP | User Datagram Protocol / Transmission Control Protocol |
| VP8 | Video codec defined in RFC 6386 |
| WebRTC | Web Real-Time Communication |
