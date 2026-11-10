// Workers AI Whisper: audio in, WebVTT out. Node-only (the audio is extracted by ffmpeg).

export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

type WhisperSegment = { start: number; end: number; text: string };

function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`;
}

/** Cue text is escaped for WebVTT: & and < as entities, and any run of dashes before > (`-->` would end the cue) as ->, so `--->` cannot become `-->`. */
const cueText = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/-{2,}>/g, "->");

/** Skips empty text, and a segment whose start or end is not a finite number or whose end is not after its start. */
export function segmentsToVtt(segments: WhisperSegment[]): string {
  let out = "WEBVTT\n\n";
  for (const seg of segments) {
    const text = seg.text.trim();
    if (text === "") continue;
    if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end) || seg.end <= seg.start) continue;
    out += `${stamp(seg.start)} --> ${stamp(seg.end)}\n${cueText(text)}\n\n`;
  }
  return out;
}

/** Returns WebVTT. Uses result.vtt when it is WEBVTT, else converts result.segments, else throws. */
export async function transcribe(
  audio: Uint8Array,
  opts: { accountId: string; token: string; fetch?: typeof fetch },
): Promise<string> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${WHISPER_MODEL}`;
  const res = await (opts.fetch ?? fetch)(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio: Buffer.from(audio).toString("base64"),
      task: "transcribe",
      language: "en",
      vad_filter: true,
    }),
  });
  let payload: {
    success?: boolean;
    result?: { vtt?: unknown; segments?: unknown };
    errors?: unknown;
  } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    // Fall through: the status check below reports it.
  }
  if (res.status < 200 || res.status > 299 || payload.success === false) {
    throw new Error(
      `Whisper HTTP ${res.status}: ${JSON.stringify(payload.errors ?? null).slice(0, 300)}`,
    );
  }
  const vtt = payload.result?.vtt;
  if (typeof vtt === "string" && vtt.startsWith("WEBVTT")) return vtt;
  const segments = payload.result?.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    return segmentsToVtt(segments as WhisperSegment[]);
  }
  throw new Error("Whisper returned neither WebVTT nor segments");
}
