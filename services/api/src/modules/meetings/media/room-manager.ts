import type {
  ConsumerOptions,
  MediaKind,
  ProducerInfo,
  ProducerSource,
  TransportOptions,
} from "@doan/shared";
import * as mediasoup from "mediasoup";
import {EventEmitter} from 'node:events';
import type {
  ActiveSpeakerObserver,
  AudioLevelObserver,
  Consumer,
  DtlsParameters,
  Producer,
  Router,
  RtpCapabilities,
  RtpParameters,
  WebRtcTransport,
  Worker as MediasoupWorker,
} from "mediasoup/types";
import { mediasoupConfig } from "./config.js";
import { config } from "../../../config/config.js";
import { getIceServers } from "./ice.js";

interface Peer {
  socketId: string;
  userId: string;
  displayName: string;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  pendingSources: Set<string>;
  pendingTransports: number;
  pendingConsumers: Set<string>;
}

interface Room {
  id: string;
  router: Router;
  worker: MediasoupWorker;
  peers: Map<string, Peer>; // key: socketId
  speakerObserver: ActiveSpeakerObserver | null;
  levelObserver: AudioLevelObserver | null;
  dominantSocketId: string | null;
}

// Dominant-speaker video gets a higher share of the downlink when the estimate is tight.
const SPEAKER_PRIORITY = 2;
const DEFAULT_PRIORITY = 1;
export const SPEAKER_OBSERVER_INTERVAL_MS = 300;
export const AUDIO_LEVEL_INTERVAL_MS = 400;
export const AUDIO_LEVEL_THRESHOLD_DB = -60;

class MediasoupRoomManager {
  readonly events=new EventEmitter();
  private workers: MediasoupWorker[] = [];
  private allocations = new Map<number,number>();
  private rooms = new Map<string, Room>();
  private workerPending: Promise<void> | null = null;
  private roomsPending = new Map<string, Promise<Room>>();

  private async getWorker(): Promise<MediasoupWorker> {
    const count=Math.min(8,config.mediaWorkers);
    if(this.workers.length<count){
      this.workerPending??=(async()=>{
        while(this.workers.length<count){
          const worker=await mediasoup.createWorker(mediasoupConfig.worker);
          worker.on('died',()=>{
            console.error(JSON.stringify({level:'error',event:'media_worker_died',pid:worker.pid}));
            this.workers=this.workers.filter(item=>item!==worker);
            this.allocations.delete(worker.pid);
            for(const room of [...this.rooms.values()])if(room.worker===worker){
              for(const peer of [...room.peers.values()])this.events.emit('media_failure',{roomId:room.id,socketId:peer.socketId,reason:'Máy chủ media khởi động lại. Hãy tham gia lại.'});
              room.router.close();this.rooms.delete(room.id);
            }
            // The next join replaces the failed worker; API/chat remain available.
          });
          this.workers.push(worker);
        }
      })().finally(()=>{this.workerPending=null;});
      await this.workerPending;
    }
    const worker=[...this.workers].sort((a,b)=>(this.allocations.get(a.pid)??0)-(this.allocations.get(b.pid)??0))[0];
    if(!worker)throw new Error('Media worker unavailable');
    this.allocations.set(worker.pid,(this.allocations.get(worker.pid)??0)+1);
    return worker;
  }

  async getOrCreateRoom(roomId: string): Promise<Room> {
    const pending = this.roomsPending.get(roomId);
    if (pending) return pending;
    const operation = this.createRoom(roomId);
    this.roomsPending.set(roomId, operation);
    try {
      return await operation;
    } finally {
      this.roomsPending.delete(roomId);
    }
  }

  private async createRoom(roomId: string): Promise<Room> {
    let room = this.rooms.get(roomId);
    if (!room) {
      const worker = await this.getWorker();
      const router = await worker.createRouter(mediasoupConfig.router).catch(error=>{this.releaseWorker(worker);throw error;});
      room = {
        id: roomId,
        router,
        worker,
        peers: new Map(),
        speakerObserver: null,
        levelObserver: null,
        dominantSocketId: null,
      };
      this.rooms.set(roomId, room);
      await this.observeSpeakers(room);
    }
    return room;
  }

  // Observers are an enhancement: a failure here must not block the call itself.
  private async observeSpeakers(room: Room) {
    try {
      room.speakerObserver = await room.router.createActiveSpeakerObserver({
        interval: SPEAKER_OBSERVER_INTERVAL_MS,
      });
      room.levelObserver = await room.router.createAudioLevelObserver({
        maxEntries: 16,
        threshold: AUDIO_LEVEL_THRESHOLD_DB,
        interval: AUDIO_LEVEL_INTERVAL_MS,
      });
    } catch (error) {
      console.error(
        JSON.stringify({ level: "warn", event: "speaker_observer_failed", message: String(error) }),
      );
      return;
    }
    room.speakerObserver.on("dominantspeaker", ({ producer }) => {
      const peer = this.peerOfProducer(room, producer.id);
      if (!peer || room.dominantSocketId === peer.socketId) return;
      const previous = room.dominantSocketId;
      room.dominantSocketId = peer.socketId;
      void this.applySpeakerPriority(room, previous, peer.socketId);
      this.events.emit("active_speaker", {
        roomId: room.id,
        socketId: peer.socketId,
        userId: peer.userId,
        at: Date.now(),
      });
    });
    room.levelObserver.on("volumes", (volumes) => {
      const levels = volumes
        .map(({ producer, volume }) => ({
          socketId: this.peerOfProducer(room, producer.id)?.socketId,
          volume,
        }))
        .filter((item): item is { socketId: string; volume: number } => Boolean(item.socketId));
      this.events.emit("audio_levels", { roomId: room.id, levels });
    });
    room.levelObserver.on("silence", () =>
      this.events.emit("audio_levels", { roomId: room.id, levels: [] }),
    );
  }

  private peerOfProducer(room: Room, producerId: string) {
    for (const peer of room.peers.values()) if (peer.producers.has(producerId)) return peer;
    return undefined;
  }

  private async applySpeakerPriority(room: Room, previous: string | null, next: string | null) {
    for (const peer of room.peers.values())
      for (const consumer of peer.consumers.values()) {
        if (consumer.kind !== "video" || consumer.closed) continue;
        const owner = this.peerOfProducer(room, consumer.producerId)?.socketId;
        if (owner !== previous && owner !== next) continue;
        await consumer
          .setPriority(owner === next ? SPEAKER_PRIORITY : DEFAULT_PRIORITY)
          .catch(() => {});
      }
  }

  activeSpeaker(roomId: string) {
    return this.rooms.get(roomId)?.dominantSocketId ?? null;
  }

  getPeer(roomId: string, socketId: string): Peer | undefined {
    return this.rooms.get(roomId)?.peers.get(socketId);
  }

  async joinRoom(
    roomId: string,
    socketId: string,
    userId: string,
    displayName: string,
  ): Promise<{ routerRtpCapabilities: RtpCapabilities; existingProducers: ProducerInfo[] }> {
    const room = await this.getOrCreateRoom(roomId);

    let peer = room.peers.get(socketId);
    if (!peer) {
      peer = {
        socketId,
        userId,
        displayName,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        pendingSources: new Set(),
        pendingTransports: 0,
        pendingConsumers: new Set(),
      };
      room.peers.set(socketId, peer);
    }

    const existingProducers = this.getRoomProducers(roomId).filter((p) => p.socketId !== socketId);

    return {
      routerRtpCapabilities: room.router.rtpCapabilities,
      existingProducers,
    };
  }

  async createWebRtcTransport(roomId: string, socketId: string): Promise<TransportOptions> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");
    const peer = room.peers.get(socketId);
    if (!peer) throw new Error("Peer not found in room");
    if (peer.transports.size + peer.pendingTransports >= 2)
      throw new Error("Transport limit reached");
    peer.pendingTransports++;

    const transport = await room.router
      .createWebRtcTransport({
        listenIps: mediasoupConfig.webRtcTransport.listenIps,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate:
          mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
      })
      .finally(() => {
        peer.pendingTransports--;
      });
    if (this.getPeer(roomId, socketId) !== peer) {
      transport.close();
      throw new Error("Peer left during transport creation");
    }

    peer.transports.set(transport.id, transport);
    transport.on('dtlsstatechange',state=>{if(state==='failed'&&!transport.closed)this.events.emit('media_failure',{roomId,socketId,reason:'DTLS thất bại. Thiết bị đã dừng; hãy tham gia lại.'});});

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      iceServers: getIceServers(peer.userId),
    };
  }

  async connectTransport(
    roomId: string,
    socketId: string,
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    const peer = this.getPeer(roomId, socketId);
    if (!peer) throw new Error("Peer not found");

    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error("Transport not found");

    await transport.connect({ dtlsParameters });
  }

  async restartIce(roomId: string, socketId: string, transportId: string) {
    const transport = this.getPeer(roomId, socketId)?.transports.get(transportId);
    if (!transport || transport.closed) throw new Error("Transport no longer available");
    return transport.restartIce();
  }

  async setConsumerLayer(
    roomId: string,
    socketId: string,
    consumerId: string,
    spatialLayer: number,
  ) {
    if (!Number.isInteger(spatialLayer) || spatialLayer < 0 || spatialLayer > 2)
      throw new Error("Invalid spatial layer");
    const consumer = this.getPeer(roomId, socketId)?.consumers.get(consumerId);
    if (!consumer) throw new Error("Consumer no longer available");
    if (consumer.type === "simulcast")
      await consumer.setPreferredLayers({ spatialLayer, temporalLayer: 2 });
  }

  async createProducer(
    roomId: string,
    socketId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
    appData: { source: ProducerSource },
  ): Promise<ProducerInfo> {
    const peer = this.getPeer(roomId, socketId);
    if (!peer) throw new Error("Peer not found");

    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error("Transport not found");

    const source = appData?.source;
    if (
      !["mic", "webcam", "screen"].includes(source) ||
      (source === "mic" ? kind !== "audio" : kind !== "video")
    )
      throw new Error("Invalid media source");
    if (
      peer.pendingSources.has(source) ||
      [...peer.producers.values()].some((item) => item.appData.source === source)
    )
      throw new Error("Source already published");
    if (peer.producers.size + peer.pendingSources.size >= config.meetingMaxSources)
      throw new Error("Media source limit reached");
    peer.pendingSources.add(source);
    const producer = await transport
      .produce({
        kind,
        rtpParameters,
        appData,
      })
      .finally(() => peer.pendingSources.delete(source));
    if (this.getPeer(roomId, socketId) !== peer) {
      producer.close();
      throw new Error("Peer left during produce");
    }

    peer.producers.set(producer.id, producer);
    if (kind === "audio") {
      const room = this.rooms.get(roomId);
      for (const observer of [room?.speakerObserver, room?.levelObserver])
        await observer?.addProducer({ producerId: producer.id }).catch(() => {});
    }

    producer.on("transportclose", () => {
      producer.close();
      peer.producers.delete(producer.id);
    });

    return {
      producerId: producer.id,
      socketId,
      userId: peer.userId,
      displayName: peer.displayName,
      kind,
      source: appData.source,
    };
  }

  async createConsumer(
    roomId: string,
    consumerSocketId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<ConsumerOptions | null> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");

    const consumerPeer = room.peers.get(consumerSocketId);
    if (!consumerPeer) throw new Error("Consumer peer not found");
    if(consumerPeer.pendingConsumers.has(producerId)||[...consumerPeer.consumers.values()].some(item=>item.producerId===producerId))throw new Error('Producer already consumed');
    if(consumerPeer.consumers.size+consumerPeer.pendingConsumers.size>=config.meetingMaxUsers*config.meetingMaxSources)throw new Error('Consumer limit reached');

    // Tìm producer và peer sở hữu producer
    let targetProducer: Producer | undefined;
    let producerPeer: Peer | undefined;

    for (const p of room.peers.values()) {
      if (p.producers.has(producerId)) {
        targetProducer = p.producers.get(producerId);
        producerPeer = p;
        break;
      }
    }

    if (!targetProducer || !producerPeer) {
      throw new Error("Target producer not found");
    }

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      return null;
    }

    // Tìm recv transport của consumer peer
    // (transport nào không phải là send transport chính hoặc transport đầu tiên)
    const transports = Array.from(consumerPeer.transports.values());
    const recvTransport = transports[1] || transports[0];
    if (!recvTransport) {
      throw new Error("Recv transport not found for consumer");
    }

    consumerPeer.pendingConsumers.add(producerId);
    const consumer = await recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // mediasoup best practice: create paused, resume on client ready
    }).finally(()=>consumerPeer.pendingConsumers.delete(producerId));
    if(this.getPeer(roomId,consumerSocketId)!==consumerPeer||targetProducer.closed){consumer.close();throw new Error('Peer or producer left during consume');}

    consumerPeer.consumers.set(consumer.id, consumer);
    if (consumer.kind === "video" && room.dominantSocketId === producerPeer.socketId)
      await consumer.setPriority(SPEAKER_PRIORITY).catch(() => {});

    consumer.on("transportclose", () => {
      consumer.close();
      consumerPeer.consumers.delete(consumer.id);
    });

    consumer.on("producerclose", () => {
      consumer.close();
      consumerPeer.consumers.delete(consumer.id);
    });

    const source = (targetProducer.appData?.source as ProducerSource) || "webcam";

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind as MediaKind,
      rtpParameters: consumer.rtpParameters,
      producerSocketId: producerPeer.socketId,
      userId: producerPeer.userId,
      displayName: producerPeer.displayName,
      source,
    };
  }

  // Paused consumers stop SFU -> client forwarding (off-page tiles in the dynamic grid).
  async pauseConsumer(roomId: string, socketId: string, consumerId: string): Promise<void> {
    const consumer = this.getPeer(roomId, socketId)?.consumers.get(consumerId);
    if (consumer && !consumer.paused) await consumer.pause();
  }

  async resumeConsumer(roomId: string, socketId: string, consumerId: string): Promise<void> {
    const peer = this.getPeer(roomId, socketId);
    const consumer = peer?.consumers.get(consumerId);
    if (consumer) {
      await consumer.resume();
    }
  }

  closeProducer(roomId: string, socketId: string, producerId: string): void {
    const peer = this.getPeer(roomId, socketId);
    if (!peer) return;
    const producer = peer.producers.get(producerId);
    if (producer) {
      producer.close();
      peer.producers.delete(producerId);
    }
  }

  leaveRoom(roomId: string, socketId: string): { closedProducerIds: string[] } {
    const room = this.rooms.get(roomId);
    if (!room) return { closedProducerIds: [] };

    const peer = room.peers.get(socketId);
    if (!peer) return { closedProducerIds: [] };

    const closedProducerIds = Array.from(peer.producers.keys());

    // Đóng tất cả producers
    for (const producer of peer.producers.values()) {
      producer.close();
    }
    peer.producers.clear();

    // Đóng tất cả consumers
    for (const consumer of peer.consumers.values()) {
      consumer.close();
    }
    peer.consumers.clear();

    // Đóng tất cả transports
    for (const transport of peer.transports.values()) {
      transport.close();
    }
    peer.transports.clear();

    room.peers.delete(socketId);
    if (room.dominantSocketId === socketId) {
      room.dominantSocketId = null;
      this.events.emit("active_speaker", { roomId, socketId: null, userId: null, at: Date.now() });
    }

    // Nếu phòng không còn ai, đóng router
    if (room.peers.size === 0) {
      room.router.close();
      this.rooms.delete(roomId);
      this.releaseWorker(room.worker);
    }

    return { closedProducerIds };
  }

  getRoomProducers(roomId: string): ProducerInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const list: ProducerInfo[] = [];
    for (const peer of room.peers.values()) {
      for (const producer of peer.producers.values()) {
        list.push({
          producerId: producer.id,
          socketId: peer.socketId,
          userId: peer.userId,
          displayName: peer.displayName,
          kind: producer.kind as MediaKind,
          source: (producer.appData?.source as ProducerSource) || "webcam",
        });
      }
    }
    return list;
  }

  async getRoomStats(
    roomId: string,
  ): Promise<{ socketId: string; userId: string; transportId: string; stats: unknown[] }[]> {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const results: { socketId: string; userId: string; transportId: string; stats: unknown[] }[] =
      [];
    for (const peer of room.peers.values()) {
      for (const [transportId, transport] of peer.transports) {
        try {
          const stats = await transport.getStats();
          results.push({
            socketId: peer.socketId,
            userId: peer.userId,
            transportId,
            stats,
          });
        } catch {
          // ignore
        }
      }
    }
    return results;
  }

  close(): void {
    for (const room of this.rooms.values()) room.router.close();
    this.rooms.clear();
    for(const worker of this.workers)worker.close();
    this.workers = [];
    this.allocations.clear();
    this.workerPending = null;
  }
  private releaseWorker(worker:MediasoupWorker){this.allocations.set(worker.pid,Math.max(0,(this.allocations.get(worker.pid)??1)-1));}
  metrics(){return {workers:this.workers.length,rooms:this.rooms.size,peers:[...this.rooms.values()].reduce((sum,room)=>sum+room.peers.size,0),workerRooms:this.workers.map(worker=>({pid:worker.pid,rooms:this.allocations.get(worker.pid)??0}))};}
  async resourceUsage(){return Promise.all(this.workers.map(async worker=>({pid:worker.pid,usage:await worker.getResourceUsage()})));}
}

export const roomManager = new MediasoupRoomManager();
