import { requestTranscript, transcriptionEnabled, type Segment } from "../../../infrastructure/speech/transcribe.js";
import type { PbxEvent } from "../domain/ports.js";

// 2.1: a hotline recording ("call-<callId>", see AcdService.onAgentAnswered) is sent to the speech
// service as soon as Asterisk closes the file, so supervisors can read and search a call without
// listening to it, and a call promoted to a lesson already has its words.

const CALL_RECORDING = /^call-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface CallTranscriptStore {
  setCallTranscript(callId: string, status: "processing" | "ready" | "failed", segments: Segment[] | null): Promise<void>;
}

export class CallTranscriptService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: CallTranscriptStore,
    private readonly fetchRecording: (name: string) => Promise<Response>,
    private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {},
    private readonly enabled: () => boolean = transcriptionEnabled,
    private readonly transcribe: (file: Buffer, name: string) => Promise<Segment[]> = (file, name) => requestTranscript(file, name, "audio/wav"),
  ) {}

  /** Queues the transcription and returns at once: the PBX event chain must not wait on the speech service. */
  handle(event: PbxEvent): Promise<void> | null {
    if (event.type !== "recording_finished" || event.durationSeconds <= 0 || !this.enabled()) return null;
    const callId = CALL_RECORDING.exec(event.name)?.[1];
    if (!callId) return null;
    // One at a time: a load test ends hundreds of calls together and the speech service is the bottleneck.
    const run = this.queue.then(() => this.run(callId, event.name));
    this.queue = run;
    return run;
  }

  private async run(callId: string, name: string) {
    try {
      await this.store.setCallTranscript(callId, "processing", null);
      const audio = Buffer.from(await (await this.fetchRecording(name)).arrayBuffer());
      const segments = await this.transcribe(audio, `${name}.wav`);
      await this.store.setCallTranscript(callId, "ready", segments);
      this.log("cc_transcript_ready", { callId, segments: segments.length });
    } catch (error) {
      this.log("cc_transcript_failed", { callId, message: error instanceof Error ? error.message : String(error) });
      await this.store.setCallTranscript(callId, "failed", null).catch(() => undefined);
    }
  }
}
