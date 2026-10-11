import type {
  ConsumerOptions,
  MediaKind,
  ProducerSource,
  QosMetrics,
  TransportOptions,
} from "@doan/shared";
import { Device, type types } from "mediasoup-client";
import { QosCollector, type RtcSample } from "./qos";

export class MediasoupClientService {
  private device: Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private producers = new Map<string, types.Producer>(); // key: source ('mic', 'webcam', 'screen')
  private consumers = new Map<string, types.Consumer>(); // key: consumerId
  private recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  private restartHandler: ((transportId: string) => Promise<unknown>) | null = null;
  private failureHandler: ((message: string) => void) | null = null;
  configureRecovery(
    restart: (transportId: string) => Promise<unknown>,
    failed: (message: string) => void,
  ) {
    this.restartHandler = restart;
    this.failureHandler = failed;
    this.closed = false;
  }
  private watchTransport(transport: types.Transport) {
    let attempts = 0,
      pending = false;
    transport.on("connectionstatechange", (state) => {
      const old = this.recoveryTimers.get(transport.id);
      if (old) clearTimeout(old);
      this.recoveryTimers.delete(transport.id);
      if (!["disconnected", "failed"].includes(state) || this.closed || pending) return;
      const timer = setTimeout(
        () => {
          this.recoveryTimers.delete(transport.id);
          if (
            this.closed ||
            transport.closed ||
            ["connected", "closed"].includes(transport.connectionState)
          )
            return;
          if (attempts >= 2 || !this.restartHandler) {
            this.failureHandler?.(
              "Không khôi phục được media. Thiết bị đã dừng; hãy tham gia lại.",
            );
            return;
          }
          attempts++;
          pending = true;
          void this.restartHandler(transport.id)
            .then((iceParameters) => {
              if (!this.closed && !transport.closed)
                return transport.restartIce({
                  iceParameters: iceParameters as types.IceParameters,
                });
            })
            .catch(() => {
              if (!this.closed)
                this.failureHandler?.("Khởi động lại ICE thất bại. Hãy tham gia lại.");
            })
            .finally(() => {
              pending = false;
              if (!this.closed && !transport.closed && transport.connectionState !== "connected")
                this.watchRecoveryFailure(transport);
            });
        },
        state === "failed" ? 0 : 5000,
      );
      this.recoveryTimers.set(transport.id, timer);
    });
  }
  private watchRecoveryFailure(transport: types.Transport) {
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(transport.id);
      if (!this.closed && !transport.closed && transport.connectionState !== "connected")
        this.failureHandler?.("Media chưa kết nối sau khi khôi phục ICE. Hãy tham gia lại.");
    }, 10000);
    this.recoveryTimers.set(transport.id, timer);
  }

  get rtpCapabilities(): types.RtpCapabilities | undefined {
    return this.device?.rtpCapabilities;
  }

  get isLoaded(): boolean {
    return this.device?.loaded ?? false;
  }

  async loadDevice(routerRtpCapabilities: unknown): Promise<void> {
    this.device = new Device();
    await this.device.load({
      routerRtpCapabilities: routerRtpCapabilities as types.RtpCapabilities,
    });
    if (this.closed) throw new Error("Media đã đóng trong khi khởi tạo thiết bị.");
  }

  initSendTransport(
    options: TransportOptions,
    onConnect: (dtlsParameters: unknown) => Promise<void>,
    onProduce: (
      kind: MediaKind,
      rtpParameters: unknown,
      appData: { source: ProducerSource },
    ) => Promise<string>,
  ): types.Transport {
    if (!this.device) throw new Error("Device chưa được khởi tạo");

    const transport = this.device.createSendTransport({
      id: options.id,
      iceParameters: options.iceParameters as types.IceParameters,
      iceCandidates: options.iceCandidates as types.IceCandidate[],
      dtlsParameters: options.dtlsParameters as types.DtlsParameters,
      iceServers: options.iceServers,
      iceTransportPolicy: options.iceTransportPolicy,
    });

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      onConnect(dtlsParameters).then(callback).catch(errback);
    });

    transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
      onProduce(kind as MediaKind, rtpParameters, appData as { source: ProducerSource })
        .then((id) => callback({ id }))
        .catch(errback);
    });

    this.sendTransport = transport;
    this.watchTransport(transport);
    return transport;
  }

  initRecvTransport(
    options: TransportOptions,
    onConnect: (dtlsParameters: unknown) => Promise<void>,
  ): types.Transport {
    if (!this.device) throw new Error("Device chưa được khởi tạo");

    const transport = this.device.createRecvTransport({
      id: options.id,
      iceParameters: options.iceParameters as types.IceParameters,
      iceCandidates: options.iceCandidates as types.IceCandidate[],
      dtlsParameters: options.dtlsParameters as types.DtlsParameters,
      iceServers: options.iceServers,
      iceTransportPolicy: options.iceTransportPolicy,
    });

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      onConnect(dtlsParameters).then(callback).catch(errback);
    });

    this.recvTransport = transport;
    this.watchTransport(transport);
    return transport;
  }

  async produce(track: MediaStreamTrack, source: ProducerSource): Promise<types.Producer> {
    if (!this.sendTransport) throw new Error("SendTransport chưa sẵn sàng");

    // Nếu đã có producer cho source này, đóng trước
    const existing = this.producers.get(source);
    if (existing) {
      existing.close();
      this.producers.delete(source);
    }

    const producer = await this.sendTransport.produce({
      track,
      appData: { source },
      stopTracks: false,
      ...(track.kind === "video" && source === "webcam"
        ? {
            encodings: [
              { rid: "q", scaleResolutionDownBy: 4, maxBitrate: 150000 },
              { rid: "h", scaleResolutionDownBy: 2, maxBitrate: 400000 },
              { rid: "f", scaleResolutionDownBy: 1, maxBitrate: 1200000 },
            ],
          }
        : {}),
      // In-band FEC recovers lost voice packets. DTX stays off: it can clip word endings.
      ...(track.kind === "audio" ? { codecOptions: { opusStereo: false, opusFec: true } } : {}),
    });

    this.producers.set(source, producer);

    producer.on("transportclose", () => {
      this.producers.delete(source);
    });

    producer.on("trackended", () => {
      producer.close();
      this.producers.delete(source);
    });

    return producer;
  }

  async consume(options: ConsumerOptions): Promise<types.Consumer> {
    const existing = [...this.consumers.values()].find(
      (consumer) => consumer.producerId === options.producerId,
    );
    if (existing) return existing;
    if (!this.recvTransport) throw new Error("RecvTransport chưa sẵn sàng");

    const consumer = await this.recvTransport.consume({
      id: options.id,
      producerId: options.producerId,
      kind: options.kind,
      rtpParameters: options.rtpParameters as types.RtpParameters,
      appData: { source: options.source },
    });

    this.consumers.set(consumer.id, consumer);

    consumer.on("transportclose", () => {
      this.consumers.delete(consumer.id);
    });

    return consumer;
  }

  getProducer(source: ProducerSource): types.Producer | undefined {
    return this.producers.get(source);
  }
  videoConsumerIdForTrack(trackId: string) {
    return [...this.consumers.values()].find((consumer) => consumer.track.id === trackId)?.id;
  }
  getVideoConsumerIds() {
    return [...this.consumers.values()]
      .filter((consumer) => consumer.kind === "video" && consumer.appData.source === "webcam")
      .map((consumer) => consumer.id);
  }

  closeProducer(source: ProducerSource): string | undefined {
    const producer = this.producers.get(source);
    if (producer) {
      const id = producer.id;
      producer.close();
      this.producers.delete(source);
      return id;
    }
    return undefined;
  }

  private qosCollector = new QosCollector();

  closeConsumer(producerId: string): string | undefined {
    const consumer = [...this.consumers.values()].find((item) => item.producerId === producerId);
    if (consumer) {
      const trackId = consumer.track.id;
      consumer.close();
      this.consumers.delete(consumer.id);
      return trackId;
    }
  }

  async getQosMetrics(): Promise<QosMetrics | null> {
    try {
      const transports = [
        { direction: "send" as const, transport: this.sendTransport },
        { direction: "receive" as const, transport: this.recvTransport },
      ].filter((item) => item.transport !== null);
      if (!transports.length) return null;
      const reports = await Promise.all(
        transports.map(async ({ direction, transport }) => ({
          direction,
          samples: [...(await transport!.getStats()).values()] as RtcSample[],
        })),
      );
      return this.qosCollector.collect(reports);
    } catch {
      return null;
    }
  }

  close(): void {
    this.closed = true;
    this.recoveryTimers.forEach((timer) => clearTimeout(timer));
    this.recoveryTimers.clear();
    this.restartHandler = null;
    this.failureHandler = null;
    this.qosCollector.reset();
    for (const p of this.producers.values()) {
      p.close();
    }
    this.producers.clear();

    for (const c of this.consumers.values()) {
      c.close();
    }
    this.consumers.clear();

    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }

    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }

    this.device = null;
  }
}
