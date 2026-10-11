# INTRODUCTION AND OVERVIEW

## Reasons for choosing the topic

Remote work, online learning and online communities have become everyday activities. A typical team, however, still uses several platforms side by side: one application for daily chat, another for video meetings and a third one for assigning tasks. Each switch between tools breaks the flow of work. The context of a discussion does not follow the team into the meeting, "who is available right now" is not visible next to the channel where the discussion happens, and the history of a project ends up scattered across services.

Platforms such as Discord and Slack have shown that organising communication as **workspaces (servers) containing channels** solves the organisational part of the problem well [@slack], [@discord]. A department or a class becomes a workspace, each topic or activity becomes a channel, and users can move between text channels and voice/video channels without leaving the application. Building such a platform, however, requires solving two technically demanding problems at the same time: low-latency, reliable delivery of messages and presence to many concurrent connections, and multipoint audio/video conferencing inside the browser that does not overload the participants' devices as the room grows. These two problems are the core of real-time web engineering and make the topic suitable for a graduation thesis that combines software design with quantitative evaluation.

## Problem statement

The thesis addresses three concrete problems:

1. **Fragmented communication tools.** Messaging and video calls live in separate applications, so the working context is split.
2. **Limits of full-mesh peer-to-peer conferencing.** When every participant connects directly to every other participant, each browser has to encode and upload a separate stream for each peer. Uplink bandwidth and CPU usage grow linearly with the number of participants, and the browser becomes overloaded as soon as several people turn on their cameras.
3. **Instant state synchronisation.** Presence, typing indicators and new messages must reach exactly the right users of the right channel with low latency. The system must also tolerate users with several open tabs, sudden network loss, and a server that runs as several processes.

## Objectives

The thesis sets four objectives, which are revisited in Chapter 6:

- **O1 – Integrated workspace.** Build an "all-in-one" web platform organised as *Workspace → Channel* that lets users move freely between workspaces and between text and voice/video channels.
- **O2 – Real-time messaging and presence.** Provide channel-based real-time messaging that neither loses nor duplicates messages under retries and reconnections, together with synchronised presence (online, offline, typing).
- **O3 – Multipoint video conferencing.** Provide in-browser multipoint video conferencing without plug-ins, based on an SFU so that a client's uplink and CPU do not grow with the number of participants, together with meeting moderation.
- **O4 – Quantitative evaluation.** Measure transmission quality (delay, jitter, packet loss), the load behaviour of the WebSocket core, and compare the SFU with a mesh baseline under identical conditions.

## Scope

### Target users

Distributed project teams, educational organisations that use e-learning, and online communities.

### In scope

- A single-page web application for modern browsers (Chromium, Firefox, Safari).
- A two-level hierarchy of workspaces and channels, with role-based access control at workspace level (owner/admin/member) and at meeting level (host/co-host/member).
- Text channels: messages, threaded replies, mentions, reactions, pins, bookmarks, attachments and search.
- Voice/video channels: join and leave, microphone/camera control, screen sharing, a dynamic video grid and moderation (waiting room, lock, admit, remove, mute, raise hand, end).
- Quality monitoring: collecting and exporting RTT, jitter, packet loss and bitrate of a call.

The system also contains a few supporting features: a Kanban task board, Google sign-in and a personal profile. They are described in the implementation chapter but are not the focus of the evaluation.

### Out of scope

Native mobile applications, call recording, end-to-end encryption through the SFU, and multi-region deployment are outside the scope of this thesis.

## Methodology

The work followed four steps:

1. **Literature study** of the WebSocket protocol, the WebRTC protocol suite (SDP, ICE/STUN/TURN, DTLS-SRTP, RTP/RTCP) and the Mesh, MCU and SFU conferencing architectures.
2. **Analysis and design**: functional and non-functional requirements, a system block diagram with three main blocks (client, application/signalling server, SFU media server), the database and the access-control model.
3. **Implementation**: a Node.js + Socket.IO + PostgreSQL server, a mediasoup SFU with a worker pool, and a React/TypeScript single-page client with a dynamic video grid.
4. **Experiments and evaluation**: automated tests, a WebSocket load test with 50/100/200 connections, and a media laboratory in which each participant is a real headless Chromium browser with a synthetic camera. The laboratory measures uplink, downlink, CPU, RTT, jitter and packet loss for a mesh baseline and for the SFU.

## Technologies used

Table 1.1 lists the main technologies of each layer. The client is built with React [@react], the server with Node.js and Socket.IO [@socketio], and the media server with mediasoup [@mediasoup].

TABLE: Table 1.1. Technologies used in the system
| Layer | Technologies |
| --- | --- |
| User interface | React 19, TypeScript 5, Vite 6, mediasoup-client 3, socket.io-client 4 |
| Application server | Node.js 22, TypeScript, Socket.IO 4, JWT (jose), scrypt password hashing |
| Media server | mediasoup 3 (C++ workers), VP8 simulcast, Opus |
| Data | PostgreSQL 17 (data, Socket.IO adapter, presence with TTL); file storage in the database or S3 |
| Infrastructure | Docker Compose, Nginx (HTTPS, reverse proxy), coturn (STUN/TURN) |
| Testing | node:test, Socket.IO load scripts, media laboratory (Chromium + Chrome DevTools Protocol) |

## Report structure

The rest of the report is organised as follows:

- **Chapter 2** summarises the theory needed for the project: real-time web communication, WebRTC and multipoint conferencing architectures.
- **Chapter 3** presents the requirements, the system block diagram and the analysis of each block, the database, access control and the real-time protocols.
- **Chapter 4** describes the implementation through algorithm diagrams and the key parts of the source code.
- **Chapter 5** presents the experiments and evaluates the system against a mesh baseline and against the requirements.
- **Chapter 6** concludes the thesis, reviews the objectives of this chapter and proposes future work.
