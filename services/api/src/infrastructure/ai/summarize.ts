import { config } from "../../config/config.js";
import type { Segment } from "../speech/transcribe.js";

// 2.1: a language model reads a finished transcript and returns a summary plus follow-ups. Like the
// speech service, it is any OpenAI-compatible chat endpoint; a self-hosted one (Ollama, vLLM) keeps
// the words of meetings and calls inside the university. Only the transcript text is sent.

export const summaryEnabled = () => Boolean(config.summaryUrl);

// shortcut: long transcripts are cut, not chunked; summarize per part if meetings run past ~2 hours.
const MAX_TRANSCRIPT_CHARS = 40_000;

export const transcriptText = (segments: Segment[]) => {
  const text = segments.map((item) => `[${Math.floor(item.start / 60)}:${String(Math.floor(item.start % 60)).padStart(2, "0")}] ${item.text}`).join("\n");
  return text.length > MAX_TRANSCRIPT_CHARS ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}\n[…]` : text;
};

/** The JSON object in a model reply, which may be wrapped in a ```json fence or surrounded by prose. */
export function parseJsonReply(content: string): Record<string, unknown> {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Mô hình không trả về JSON.");
  const value: unknown = JSON.parse(content.slice(start, end + 1));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mô hình không trả về đối tượng JSON.");
  return value as Record<string, unknown>;
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

async function ask(system: string, user: string) {
  const response = await fetch(config.summaryUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.summaryApiKey ? { Authorization: `Bearer ${config.summaryApiKey}` } : {}) },
    body: JSON.stringify({
      model: config.summaryModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(`Dịch vụ tóm tắt trả lỗi ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  return parseJsonReply(String(body.choices?.[0]?.message?.content ?? ""));
}

export type MeetingDigest = { summary: string; actions: string[] };

export async function summarizeMeeting(segments: Segment[]): Promise<MeetingDigest> {
  const reply = await ask(
    'Bạn là thư ký cuộc họp ở một trường đại học. Đọc bản chép lời (có thể sai chính tả do nhận dạng giọng nói) và trả về JSON {"summary": string, "actions": string[]}. ' +
      "summary: 3–6 câu tiếng Việt nêu nội dung chính và các quyết định. actions: tối đa 10 việc cần làm cụ thể đã được giao hoặc thống nhất, mỗi việc một câu ngắn, ghi người phụ trách nếu có nêu tên. Không bịa thông tin không có trong bản chép lời.",
    transcriptText(segments),
  );
  const actions = Array.isArray(reply.actions) ? reply.actions.map((item) => clean(item, 160)).filter(Boolean).slice(0, 10) : [];
  return { summary: clean(reply.summary, 4000), actions };
}

export type CallDigest = { summary: string; dispositionId: string | null };

/** Summary for the call notes, and the disposition code (from the department's own list) that fits best. */
export async function summarizeCall(segments: Segment[], dispositions: { id: string; label: string }[]): Promise<CallDigest> {
  const codes = dispositions.map((item, index) => `${index + 1}. ${item.label}`).join("\n");
  const reply = await ask(
    'Bạn hỗ trợ tổng đài viên của một trường đại học. Đọc bản chép lời cuộc gọi và trả về JSON {"summary": string, "code": number}. ' +
      "summary: 1–3 câu tiếng Việt nêu người gọi cần gì và đã được giải quyết ra sao. code: số thứ tự của mã kết quả phù hợp nhất trong danh sách, 0 nếu không mã nào phù hợp.",
    `Mã kết quả:\n${codes || "(không có)"}\n\nBản chép lời:\n${transcriptText(segments)}`,
  );
  const code = Number(reply.code);
  return { summary: clean(reply.summary, 2000), dispositionId: Number.isInteger(code) && code >= 1 ? (dispositions[code - 1]?.id ?? null) : null };
}
