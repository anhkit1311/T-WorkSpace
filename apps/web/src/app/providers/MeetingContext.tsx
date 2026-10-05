import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ConsumerOptions, ProducerInfo, QosMetrics, TransportOptions } from "@doan/shared";
import type { MediasoupClientService } from "../../features/meetings/webrtc/mediasoup-service";
import {
  isScreenPickerCancel,
  mapMediaError,
  mediaConstraints,
  mediaErrorTitle,
  publishSelectedTracks,
  type JoinMediaOptions,
} from "../../features/meetings/webrtc/local-media";
import { useApp } from "./AppContext";
import { useSocket } from "./SocketContext";
import { io, type Socket } from "socket.io-client";
import { mediaOperation } from "../../features/meetings/webrtc/operation";

export interface RemotePeer {
  socketId: string;
  userId: string;
  displayName: string;
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  screenTrack: MediaStreamTrack | null;
  mediaStream: MediaStream;
  screenStream: MediaStream | null;
}

export interface QosHistoryPoint extends QosMetrics {
  timestamp: string;
}

interface MeetingContextValue {
  controlSocket: Socket | null;
  waitingRoomId: string;
  inCall: boolean;
  roomId: string;
  interruptedRoomId: string;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remotePeers: RemotePeer[];
  mic: boolean;
  camera: boolean;
  sharing: boolean;
  qos: QosMetrics | null;
  qosHistory: QosHistoryPoint[];
  joinCall: (roomId: string, devices?: JoinMediaOptions, scheduleId?: string) => Promise<void>;
  leaveCall: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  exportQosCsv: () => void;
  exportQosJson: () => void;
}

const MeetingContext = createContext<MeetingContextValue | null>(null);

export function MeetingProvider({ children }: { children: ReactNode }) {
  const { notify, accessToken } = useApp();
  const { socket: chatSocket } = useSocket();
  const [mediaSocket, setMediaSocket] = useState<Socket | null>(null);
  const mediaSocketRef = useRef<{ socket: Socket; endpoint: string } | null>(null);
  const activeSocketRef = useRef<Socket | null>(null);
  const socket = mediaSocket ?? chatSocket;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  useEffect(() => {
    return () => {
      mediaSocketRef.current?.socket.disconnect();
      mediaSocketRef.current = null;
      setMediaSocket(null);
    };
  }, [chatSocket]);
  useEffect(() => {
    if (mediaSocket && accessToken) mediaSocket.emit("refresh_auth", { token: accessToken });
  }, [mediaSocket, accessToken]);

  const [inCall, setInCall] = useState(false);
  const [waitingRoomId, setWaitingRoomId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [interruptedRoomId, setInterruptedRoomId] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [qos, setQos] = useState<QosMetrics | null>(null);
  const [qosHistory, setQosHistory] = useState<QosHistoryPoint[]>([]);

  const mediasoupRef = useRef<MediasoupClientService | null>(null);
  const qosTimerRef = useRef<number | null>(null);
  const joiningRef = useRef(false);
  const joinAbortRef = useRef<AbortController | null>(null);
  const joinEpochRef = useRef(0);
  const devicesRef = useRef<JoinMediaOptions>({});
  const togglingRef = useRef(new Set<string>());
  const streamsRef = useRef<MediaStream[]>([]);
  const roomIdRef = useRef("");
  const lastMeasuredRoomIdRef = useRef("");
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);
  useEffect(() => {
    streamsRef.current = [localStream, localScreenStream].filter(
      (s): s is MediaStream => s !== null,
    );
  }, [localStream, localScreenStream]);
  useEffect(() => {
    if (!socket) return;
    const cleanup = () => {
      if (activeSocketRef.current !== socket || (!roomIdRef.current && !mediasoupRef.current))
        return;
      if (roomIdRef.current) setInterruptedRoomId(roomIdRef.current);
      streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      mediasoupRef.current?.close();
      mediasoupRef.current = null;
      setLocalStream(null);
      setLocalScreenStream(null);
      setRemotePeers([]);
      setInCall(false);
      setWaitingRoomId("");
      setRoomId("");
      roomIdRef.current = "";
      setSharing(false);
      joinAbortRef.current?.abort();
      joinEpochRef.current += 1;
    };
    socket.on("disconnect", cleanup);
    const closed = (data: { roomId: string; reason: string }) => {
      if (data.roomId !== roomIdRef.current) return;
      cleanup();
      setInterruptedRoomId("");
      notify("Cuộc họp", data.reason, "info");
    };
    const muted = (data: { roomId: string }) => {
      if (data.roomId !== roomIdRef.current) return;
      mediasoupRef.current?.closeProducer("mic");
      streamsRef.current.forEach((stream) =>
        stream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        }),
      );
      setMic(false);
      notify("Host đã tắt nguồn mic", "Bạn có thể tự bật lại khi cần phát biểu.", "info");
    };
    socket.on("meeting_closed", closed);
    socket.on("meeting_mute", muted);
    return () => {
      socket.off("disconnect", cleanup);
      socket.off("meeting_closed", closed);
      socket.off("meeting_mute", muted);
      cleanup();
    };
  }, [socket]);

  useEffect(() => {
    if (!inCall || !socket) return;
    const consumers = mediasoupRef.current?.getVideoConsumerIds() ?? [];
    const spatialLayer = consumers.length > 6 ? 0 : consumers.length > 2 ? 1 : 2;
    for (const consumerId of consumers)
      socket.emit("consumer_layer", { roomId, consumerId, spatialLayer });
  }, [inCall, remotePeers, roomId, socket]);

  // Lắng nghe sự kiện Producer mới từ SFU
  useEffect(() => {
    if (!socket || !inCall) return;

    const handleNewProducer = async (producerInfo: ProducerInfo) => {
      const epoch = joinEpochRef.current;
      const ms = mediasoupRef.current;
      if (!ms?.isLoaded || !ms.rtpCapabilities) return;

      try {
        const res = (await socket.timeout(10000).emitWithAck("consume", {
          roomId,
          producerId: producerInfo.producerId,
          rtpCapabilities: ms.rtpCapabilities,
        })) as { success: boolean; params?: ConsumerOptions; error?: string };
        if (epoch !== joinEpochRef.current || roomIdRef.current !== roomId) return;
        if (!res.success || !res.params) {
          console.warn("Consume failed:", res.error);
          return;
        }

        const consumer = await ms.consume(res.params);
        if (epoch !== joinEpochRef.current) {
          ms.closeConsumer(producerInfo.producerId);
          return;
        }
        socket.emit("resume_consumer", { roomId, consumerId: consumer.id });

        // Cập nhật track vào danh sách remote peers
        setRemotePeers((prev) => {
          const existingIdx = prev.findIndex((p) => p.socketId === producerInfo.socketId);
          const targetPeer: RemotePeer =
            existingIdx >= 0
              ? { ...prev[existingIdx] }
              : {
                  socketId: producerInfo.socketId,
                  userId: producerInfo.userId,
                  displayName: producerInfo.displayName,
                  audioTrack: null,
                  videoTrack: null,
                  screenTrack: null,
                  mediaStream: new MediaStream(),
                  screenStream: null,
                };

          if (producerInfo.source === "mic") {
            targetPeer.audioTrack = consumer.track;
            targetPeer.mediaStream.addTrack(consumer.track);
          } else if (producerInfo.source === "webcam") {
            targetPeer.videoTrack = consumer.track;
            targetPeer.mediaStream.addTrack(consumer.track);
          } else if (producerInfo.source === "screen") {
            targetPeer.screenTrack = consumer.track;
            const screenMs = targetPeer.screenStream || new MediaStream();
            screenMs.addTrack(consumer.track);
            targetPeer.screenStream = screenMs;
          }

          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = targetPeer;
            return next;
          }
          return [...prev, targetPeer];
        });
      } catch (err) {
        console.error("Lỗi khi consume producer:", err);
      }
    };

    const handleProducerClosed = ({ producerId }: { producerId: string }) => {
      const trackId = mediasoupRef.current?.closeConsumer(producerId);
      setRemotePeers((prev) =>
        prev.map((peer) => {
          if (trackId && peer.videoTrack?.id === trackId) {
            peer.mediaStream.removeTrack(peer.videoTrack);
            return { ...peer, videoTrack: null };
          }
          if (trackId && peer.screenTrack?.id === trackId) {
            if (peer.screenStream) peer.screenStream.removeTrack(peer.screenTrack);
            return { ...peer, screenTrack: null, screenStream: null };
          }
          if (trackId && peer.audioTrack?.id === trackId) {
            peer.mediaStream.removeTrack(peer.audioTrack);
            return { ...peer, audioTrack: null };
          }
          return peer;
        }),
      );
    };

    const handlePeerLeft = ({ socketId }: { socketId: string }) => {
      setRemotePeers((prev) => prev.filter((p) => p.socketId !== socketId));
    };

    socket.on("new_producer", handleNewProducer);
    socket.on("producer_closed", handleProducerClosed);
    socket.on("peer_left", handlePeerLeft);

    return () => {
      socket.off("new_producer", handleNewProducer);
      socket.off("producer_closed", handleProducerClosed);
      socket.off("peer_left", handlePeerLeft);
    };
  }, [socket, inCall, roomId]);

  // Cập nhật chỉ số QoS định kỳ
  useEffect(() => {
    if (!inCall) {
      if (qosTimerRef.current) window.clearInterval(qosTimerRef.current);
      return;
    }

    qosTimerRef.current = window.setInterval(async () => {
      const epoch = joinEpochRef.current,
        service = mediasoupRef.current;
      const stats = await service?.getQosMetrics();
      if (stats && epoch === joinEpochRef.current && service === mediasoupRef.current) {
        setQos(stats);
        setQosHistory((prev) => {
          const point: QosHistoryPoint = { ...stats, timestamp: new Date().toISOString() };
          return [...prev, point].slice(-300);
        });
      }
    }, 2500);

    return () => {
      if (qosTimerRef.current) window.clearInterval(qosTimerRef.current);
    };
  }, [inCall]);

  const joinCall = async (
    targetRoomId: string,
    devices: JoinMediaOptions = {},
    scheduleId?: string,
  ) => {
    if (inCall || joiningRef.current) throw new Error("Cuộc họp đang mở hoặc đang kết nối.");
    if (waitingRoomId && waitingRoomId !== targetRoomId)
      throw new Error("Hãy rời phòng chờ hiện tại trước khi tham gia phòng khác.");
    if (!chatSocket?.connected || !accessToken) {
      throw new Error("Chưa kết nối máy chủ. Hãy thử lại sau khi mạng được khôi phục.");
    }

    joiningRef.current = true;
    const requestEpoch = ++joinEpochRef.current;
    const joinAbort = new AbortController();
    joinAbortRef.current = joinAbort;
    let selected = chatSocket;
    try {
      const location = await mediaOperation(
        fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/channels/${targetRoomId}/media-location`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: joinAbort.signal,
        }),
        joinAbort.signal,
      );
      if (!location.ok)
        throw new Error("Không tìm được phòng họp hoặc quyền truy cập đã thay đổi.");
      const data = (await location.json()) as { url: string | null };
      const endpoint = data.url || import.meta.env.VITE_SFU_URL;
      const apiOrigin = new URL(
        import.meta.env.VITE_API_URL || window.location.origin,
        window.location.origin,
      ).origin;
      if (endpoint && new URL(endpoint, window.location.origin).origin !== apiOrigin) {
        if (mediaSocketRef.current?.endpoint !== endpoint) {
          mediaSocketRef.current?.socket.disconnect();
          const media = io(endpoint, {
            auth: (callback) => callback({ token: tokenRef.current }),
            transports: ["websocket"],
            reconnectionAttempts: 5,
            timeout: 10000,
          });
          media.on("access_revoked", () => media.disconnect());
          mediaSocketRef.current = { socket: media, endpoint };
          setMediaSocket(media);
        }
        selected = mediaSocketRef.current!.socket;
        activeSocketRef.current = selected;
        if (!selected.connected)
          await new Promise<void>((resolve, reject) => {
            const connected = () => finish(),
              failed = () => finish(new Error("Không kết nối được máy chủ cuộc họp."));
            const timer = window.setTimeout(
              () => finish(new Error("Kết nối cuộc họp quá thời gian. Hãy thử lại.")),
              10000,
            );
            const finish = (error?: Error) => {
              window.clearTimeout(timer);
              selected.off("connect", connected);
              selected.off("connect_error", failed);
              if (error) reject(error);
              else resolve();
            };
            selected.once("connect", connected);
            selected.once("connect_error", failed);
          });
      } else {
        mediaSocketRef.current?.socket.disconnect();
        mediaSocketRef.current = null;
        setMediaSocket(null);
      }
      if (requestEpoch !== joinEpochRef.current) throw new Error("Tham gia đã bị hủy.");
    } catch (error) {
      if (requestEpoch === joinEpochRef.current) joiningRef.current = false;
      throw error;
    }
    const socket = selected;
    activeSocketRef.current = socket;
    const epoch = requestEpoch;
    let ms: MediasoupClientService;
    try {
      const module = await mediaOperation(import("../../features/meetings/webrtc/mediasoup-service"), joinAbort.signal);
      if (epoch !== joinEpochRef.current || !socket.connected)
        throw new Error("Tham gia đã bị hủy.");
      ms = new module.MediasoupClientService();
      mediasoupRef.current = ms;
    } catch (error) {
      if (epoch === joinEpochRef.current) joiningRef.current = false;
      throw error;
    }
    let mediaStream: MediaStream | null = null;
    const ensureCurrent = () => {
      if (epoch !== joinEpochRef.current || !socket.connected)
        throw new Error("Tham gia đã bị hủy hoặc kết nối đã ngắt.");
    };
    const request = async <T,>(event: string, payload: object): Promise<T> => {
      ensureCurrent();
      const result = await mediaOperation(
        socket.timeout(10000).emitWithAck(event, payload),
        joinAbort.signal,
        10000,
        () => {
          if (event === "join_meeting") socket.emit("leave_meeting", { roomId: targetRoomId });
        },
      );
      ensureCurrent();
      return result as T;
    };
    devicesRef.current = devices;
    ms.configureRecovery(
      async (transportId) => {
        const result = await request<{ success: boolean; iceParameters?: unknown; error?: string }>(
          "restart_ice",
          { roomId: targetRoomId, transportId },
        );
        if (!result.success || !result.iceParameters)
          throw new Error(result.error ?? "Không restart được ICE.");
        return result.iceParameters;
      },
      (message) => {
        if (epoch !== joinEpochRef.current) return;
        void leaveCall().then(() => {
          setInterruptedRoomId(targetRoomId);
          notify("Media bị gián đoạn", message, "warning");
        });
      },
    );
    try {
      setQos(null);
      setQosHistory([]);
      lastMeasuredRoomIdRef.current = targetRoomId;

      // 1. Gửi yêu cầu tham gia phòng họp qua Socket
      const joinResult = await new Promise<{
        success: boolean;
        routerRtpCapabilities?: unknown;
        existingProducers?: ProducerInfo[];
        error?: string;
        waiting?: boolean;
      }>((resolve, reject) => {
        request("join_meeting", { roomId: targetRoomId, scheduleId })
          .then((value) => resolve(value as Parameters<typeof resolve>[0]))
          .catch(reject);
      });

      if (joinResult.success && joinResult.waiting) {
        ms.close();
        mediasoupRef.current = null;
        setWaitingRoomId(targetRoomId);
        roomIdRef.current = targetRoomId;
        return;
      }
      setWaitingRoomId("");

      if (!joinResult.success || !joinResult.routerRtpCapabilities) {
        throw new Error(joinResult.error || "Không thể tham gia phòng họp");
      }

      // 2. Nạp router capabilities vào Device
      roomIdRef.current = targetRoomId;
      await mediaOperation(ms.loadDevice(joinResult.routerRtpCapabilities), joinAbort.signal);
      ensureCurrent();

      // 3. Tạo SendTransport
      const sendTransportRes = await new Promise<{
        success: boolean;
        params?: TransportOptions;
        error?: string;
      }>((resolve, reject) => {
        request("create_webrtc_transport", { roomId: targetRoomId })
          .then((value) => resolve(value as Parameters<typeof resolve>[0]))
          .catch(reject);
      });
      if (!sendTransportRes.success || !sendTransportRes.params) {
        throw new Error(sendTransportRes.error || "Lỗi tạo send transport");
      }

      ms.initSendTransport(
        sendTransportRes.params,
        (dtlsParameters) =>
          new Promise((resolve, reject) => {
            socket
              .timeout(10000)
              .emit(
                "connect_webrtc_transport",
                { roomId: targetRoomId, transportId: sendTransportRes.params!.id, dtlsParameters },
                (error: Error | null, res: { success: boolean; error?: string }) => {
                  if (error || epoch !== joinEpochRef.current) {
                    reject(error ?? new Error("Đã hủy tham gia."));
                    return;
                  }
                  if (res.success) resolve();
                  else reject(new Error(res.error));
                },
              );
          }),
        (kind, rtpParameters, appData) =>
          new Promise((resolve, reject) => {
            socket.timeout(10000).emit(
              "produce",
              {
                roomId: targetRoomId,
                transportId: sendTransportRes.params!.id,
                kind,
                rtpParameters,
                appData,
              },
              (
                error: Error | null,
                res: { success: boolean; producerId?: string; error?: string },
              ) => {
                if (error || epoch !== joinEpochRef.current) {
                  reject(error ?? new Error("Đã hủy tham gia."));
                  return;
                }
                if (res.success && res.producerId) resolve(res.producerId);
                else reject(new Error(res.error));
              },
            );
          }),
      );

      // 4. Tạo RecvTransport
      const recvTransportRes = await new Promise<{
        success: boolean;
        params?: TransportOptions;
        error?: string;
      }>((resolve, reject) => {
        request("create_webrtc_transport", { roomId: targetRoomId })
          .then((value) => resolve(value as Parameters<typeof resolve>[0]))
          .catch(reject);
      });
      if (!recvTransportRes.success || !recvTransportRes.params) {
        throw new Error(recvTransportRes.error || "Lỗi tạo recv transport");
      }

      ms.initRecvTransport(
        recvTransportRes.params,
        (dtlsParameters) =>
          new Promise((resolve, reject) => {
            socket
              .timeout(10000)
              .emit(
                "connect_webrtc_transport",
                { roomId: targetRoomId, transportId: recvTransportRes.params!.id, dtlsParameters },
                (error: Error | null, res: { success: boolean; error?: string }) => {
                  if (error || epoch !== joinEpochRef.current) {
                    reject(error ?? new Error("Đã hủy tham gia."));
                    return;
                  }
                  if (res.success) resolve();
                  else reject(new Error(res.error));
                },
              );
          }),
      );

      // 5. Khởi động Micro & Camera của người dùng
      const constraints = mediaConstraints(devices);
      try {
        if (constraints.audio || constraints.video)
          mediaStream = await mediaOperation(
            navigator.mediaDevices.getUserMedia(constraints),
            joinAbort.signal,
            30000,
            (stream) => stream.getTracks().forEach((track) => track.stop()),
          );
      } catch {
        // Nếu không có camera, thử lấy riêng mic hoặc luồng rỗng
        try {
          if (constraints.audio && !joinAbort.signal.aborted)
            mediaStream = await mediaOperation(
              navigator.mediaDevices.getUserMedia({
                audio: constraints.audio,
                video: false,
              }),
              joinAbort.signal,
              30000,
              (stream) => stream.getTracks().forEach((track) => track.stop()),
            );
        } catch {
          console.warn("Không phát hiện thiết bị thu âm/hình.");
        }
      }

      if (mediaStream) {
        ensureCurrent();
        streamsRef.current = [mediaStream];
        setLocalStream(mediaStream);
        setMic(mediaStream.getAudioTracks().length > 0);
        setCamera(mediaStream.getVideoTracks().length > 0);

        await publishSelectedTracks(mediaStream, devices, async (track, source) => {
          ensureCurrent();
          return mediaOperation(ms.produce(track, source), joinAbort.signal, 10000, (producer) =>
            producer.close(),
          );
        });
      }
      ensureCurrent();
      setMic(Boolean(mediaStream?.getAudioTracks().length) && devices.micEnabled !== false);
      setCamera(Boolean(mediaStream?.getVideoTracks().length) && devices.cameraEnabled !== false);

      // Snapshot lại sau khi transport sẵn sàng để không bỏ lỡ người vào đồng thời.
      setRoomId(targetRoomId);
      roomIdRef.current = targetRoomId;
      setInCall(true);
      const latest = await socket
        .timeout(10000)
        .emitWithAck("join_meeting", { roomId: targetRoomId });
      ensureCurrent();
      if (latest.success) joinResult.existingProducers = latest.existingProducers;
      // 6. Consume các producers đã có sẵn trong phòng
      if (joinResult.existingProducers && joinResult.existingProducers.length > 0) {
        for (const producerInfo of joinResult.existingProducers) {
          try {
            const res = await request<{
              success: boolean;
              params?: ConsumerOptions;
              error?: string;
            }>("consume", {
              roomId: targetRoomId,
              producerId: producerInfo.producerId,
              rtpCapabilities: ms.rtpCapabilities!,
            });
            if (res.success && res.params) {
              const consumer = await mediaOperation(
                ms.consume(res.params),
                joinAbort.signal,
                10000,
                (consumer) => consumer.close(),
              );
              ensureCurrent();
              socket.emit("resume_consumer", { roomId: targetRoomId, consumerId: consumer.id });

              setRemotePeers((prev) => {
                const existingIdx = prev.findIndex((p) => p.socketId === producerInfo.socketId);
                const targetPeer: RemotePeer =
                  existingIdx >= 0
                    ? { ...prev[existingIdx] }
                    : {
                        socketId: producerInfo.socketId,
                        userId: producerInfo.userId,
                        displayName: producerInfo.displayName,
                        audioTrack: null,
                        videoTrack: null,
                        screenTrack: null,
                        mediaStream: new MediaStream(),
                        screenStream: null,
                      };

                if (producerInfo.source === "mic") {
                  targetPeer.audioTrack = consumer.track;
                  targetPeer.mediaStream.addTrack(consumer.track);
                } else if (producerInfo.source === "webcam") {
                  targetPeer.videoTrack = consumer.track;
                  targetPeer.mediaStream.addTrack(consumer.track);
                } else if (producerInfo.source === "screen") {
                  targetPeer.screenTrack = consumer.track;
                  const screenMs = targetPeer.screenStream || new MediaStream();
                  screenMs.addTrack(consumer.track);
                  targetPeer.screenStream = screenMs;
                }

                if (existingIdx >= 0) {
                  const next = [...prev];
                  next[existingIdx] = targetPeer;
                  return next;
                }
                return [...prev, targetPeer];
              });
            }
          } catch (error) {
            ensureCurrent();
            console.warn("Không thể nhận nguồn media", error);
          }
        }
      }

      setRoomId(targetRoomId);
      setInterruptedRoomId("");
      setInCall(true);
      notify("Đã vào cuộc họp", "Kết nối SFU thành công.", "success");
    } catch (err: unknown) {
      mediaStream?.getTracks().forEach((track) => track.stop());
      ms.close();
      if (epoch !== joinEpochRef.current) throw err;
      socket.emit("leave_meeting", { roomId: targetRoomId });
      mediasoupRef.current = null;
      setLocalStream((stream) => {
        stream?.getTracks().forEach((track) => track.stop());
        return null;
      });
      setRemotePeers([]);
      setInCall(false);
      setRoomId("");
      roomIdRef.current = "";
      const msg = err instanceof Error ? err.message : "Không thể tham gia cuộc họp";
      notify("Lỗi cuộc họp", msg, "warning");
      console.error(err);
      throw err;
    } finally {
      if (epoch === joinEpochRef.current) joiningRef.current = false;
    }
  };

  const leaveCall = async () => {
    joinAbortRef.current?.abort();
    joiningRef.current = false;
    setWaitingRoomId("");
    joinEpochRef.current += 1;
    setInterruptedRoomId("");
    if (activeSocketRef.current && roomIdRef.current) {
      activeSocketRef.current.emit("leave_meeting", { roomId: roomIdRef.current });
    }

    // Dừng tất cả local tracks
    streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    streamsRef.current = [];
    setLocalStream(null);
    setLocalScreenStream(null);
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }
    if (localScreenStream) {
      localScreenStream.getTracks().forEach((t) => t.stop());
      setLocalScreenStream(null);
    }

    mediasoupRef.current?.close();
    mediasoupRef.current = null;

    setRemotePeers([]);
    setInCall(false);
    setRoomId("");
    roomIdRef.current = "";
    setSharing(false);
    notify("Đã rời cuộc họp", "Phiên hội nghị đã kết thúc.", "info");
  };

  const toggleSource = async (source: "mic" | "webcam") => {
    const ms = mediasoupRef.current;
    if (!inCall || !ms || togglingRef.current.has(source)) return;
    togglingRef.current.add(source);
    const epoch = joinEpochRef.current;
    let captured: MediaStream | null = null;
    let turningOn = true;
    try {
      const producer = ms.getProducer(source);
      let stream = streamsRef.current[0];
      const kind = source === "mic" ? "audio" : "video";
      let track = stream
        ?.getTracks()
        .find((item) => item.kind === kind && item.readyState === "live");
      const enabled = track?.enabled && !producer?.paused;
      turningOn = !enabled;
      if (!track) {
        const constraints = mediaConstraints({
          ...devicesRef.current,
          micEnabled: source === "mic",
          cameraEnabled: source === "webcam",
        });
        captured = await navigator.mediaDevices.getUserMedia(constraints);
        if (epoch !== joinEpochRef.current || !socket?.connected)
          throw new Error("Cuộc họp đã kết thúc.");
        track = captured.getTracks()[0];
        if (!track) throw new DOMException("Không tìm thấy thiết bị.", "NotFoundError");
        stream ??= new MediaStream();
        stream.addTrack(track);
        streamsRef.current = [stream, ...streamsRef.current.slice(1)];
        setLocalStream(stream);
      }
      track.enabled = !enabled;
      if (producer) {
        if (enabled) producer.pause();
        else producer.resume();
      } else if (!enabled) await ms.produce(track, source);
      if (epoch !== joinEpochRef.current) {
        captured?.getTracks().forEach((item) => item.stop());
        return;
      }
      if (source === "mic") setMic(!enabled);
      else setCamera(!enabled);
      notify(
        `${enabled ? "Đã tắt" : "Đã bật"} ${source === "mic" ? "micro" : "camera"}`,
        undefined,
        "info",
      );
    } catch (error) {
      captured?.getTracks().forEach((item) => item.stop());
      notify(mediaErrorTitle(source, turningOn), mapMediaError(error), "warning");
    } finally {
      togglingRef.current.delete(source);
    }
  };
  const toggleMic = () => toggleSource("mic");
  const toggleCamera = () => toggleSource("webcam");

  const toggleScreenShare = async () => {
    const ms = mediasoupRef.current,
      epoch = joinEpochRef.current,
      targetRoom = roomIdRef.current;
    if (!ms || !inCall || !socket?.connected || togglingRef.current.has("screen")) return;
    togglingRef.current.add("screen");
    let captured: MediaStream | null = null;
    try {
      if (sharing) {
        localScreenStream?.getTracks().forEach((track) => track.stop());
        const producerId = ms.closeProducer("screen");
        if (producerId) socket.emit("close_producer", { roomId: targetRoom, producerId });
        setLocalScreenStream(null);
        setSharing(false);
        return;
      }
      captured = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (epoch !== joinEpochRef.current || ms !== mediasoupRef.current)
        throw new Error("Cuộc họp đã kết thúc.");
      const track = captured.getVideoTracks()[0];
      if (!track) throw new Error("Không có nguồn màn hình.");
      const stream = captured;
      track.onended = () => {
        stream.getTracks().forEach((item) => item.stop());
        const producerId = ms.closeProducer("screen");
        if (epoch !== joinEpochRef.current) return;
        if (producerId) socket.emit("close_producer", { roomId: targetRoom, producerId });
        streamsRef.current = streamsRef.current.filter((item) => item !== stream);
        setLocalScreenStream(null);
        setSharing(false);
      };
      await ms.produce(track, "screen");
      if (epoch !== joinEpochRef.current || ms !== mediasoupRef.current)
        throw new Error("Cuộc họp đã kết thúc.");
      streamsRef.current = [...streamsRef.current, stream];
      setLocalScreenStream(stream);
      setSharing(true);
    } catch (error) {
      captured?.getTracks().forEach((track) => track.stop());
      ms.closeProducer("screen");
      if (epoch === joinEpochRef.current && !isScreenPickerCancel(error))
        notify(mediaErrorTitle("screen"), mapMediaError(error), "warning");
    } finally {
      togglingRef.current.delete("screen");
    }
  };

  const exportQosCsv = () => {
    if (qosHistory.length === 0) {
      notify("Chưa có dữ liệu", "Cần tham gia cuộc họp để ghi nhận số liệu QoS.", "warning");
      return;
    }
    const headers = ["Timestamp", "RTT (ms)", "Bitrate (kbps)", "Jitter (ms)", "Packet Loss (%)"];
    const rows = qosHistory.map((pt) => [
      pt.timestamp,
      pt.rtt,
      pt.bitrate,
      pt.jitter,
      pt.packetLoss,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      encodeURIComponent([headers.join(","), ...rows.map((r) => r.join(","))].join("\n"));
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute(
      "download",
      `webrtc-qos-${lastMeasuredRoomIdRef.current || "session"}-${Date.now()}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    notify("Đã xuất file CSV", "Dữ liệu đo kiểm QoS đã tải về máy tính.", "success");
  };

  const exportQosJson = () => {
    if (qosHistory.length === 0) {
      notify("Chưa có dữ liệu", "Cần tham gia cuộc họp để ghi nhận số liệu QoS.", "warning");
      return;
    }
    const data = {
      roomId: lastMeasuredRoomIdRef.current || "session",
      topology: "mediasoup-sfu",
      exportedAt: new Date().toISOString(),
      totalSamples: qosHistory.length,
      metrics: qosHistory,
    };
    const jsonContent =
      "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", jsonContent);
    link.setAttribute(
      "download",
      `webrtc-qos-${lastMeasuredRoomIdRef.current || "session"}-${Date.now()}.json`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    notify("Đã xuất file JSON", "Dữ liệu đo kiểm QoS đã tải về máy tính.", "success");
  };

  return (
    <MeetingContext.Provider
      value={{
        controlSocket: socket,
        inCall,
        waitingRoomId,
        roomId,
        interruptedRoomId,
        localStream,
        localScreenStream,
        remotePeers,
        mic,
        camera,
        sharing,
        qos,
        qosHistory,
        joinCall,
        leaveCall,
        toggleMic,
        toggleCamera,
        toggleScreenShare,
        exportQosCsv,
        exportQosJson,
      }}
    >
      {children}
    </MeetingContext.Provider>
  );
}

export function useMeeting() {
  const context = useContext(MeetingContext);
  if (!context) {
    throw new Error("useMeeting must be used within a MeetingProvider");
  }
  return context;
}
