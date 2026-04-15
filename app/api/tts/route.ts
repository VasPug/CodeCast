import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = { text: string; speaker: "A" | "B" };

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceA = process.env.ELEVENLABS_VOICE_A;
    const voiceB = process.env.ELEVENLABS_VOICE_B;
    if (!apiKey || !voiceA || !voiceB) {
      return NextResponse.json(
        { error: "Set ELEVENLABS_API_KEY, ELEVENLABS_VOICE_A, ELEVENLABS_VOICE_B in .env.local" },
        { status: 500 }
      );
    }

    const { text, speaker } = (await request.json()) as Body;
    if (!text || (speaker !== "A" && speaker !== "B")) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const voiceId = speaker === "A" ? voiceA : voiceB;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        output_format: "mp3_44100_128",
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: `ElevenLabs ${res.status}: ${detail}` }, { status: 502 });
    }

    const payload = (await res.json()) as {
      audio_base64: string;
      alignment?: { character_end_times_seconds?: number[] };
    };

    const ends = payload.alignment?.character_end_times_seconds;
    const durationMs =
      ends && ends.length > 0 ? Math.round(ends[ends.length - 1] * 1000) : estimateDurationMs(text);

    return NextResponse.json({
      audioBase64: payload.audio_base64,
      mimeType: "audio/mpeg",
      durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.round((words / 2.7) * 1000);
}
