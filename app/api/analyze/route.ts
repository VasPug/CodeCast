import { NextResponse } from "next/server";
import { filterEntries, type CodeFile, type RawEntry } from "@/lib/codeExtractor";
import { generateScript, sliceCodeRef, type Turn } from "@/lib/scriptPrompt";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not set in .env.local" }, { status: 500 });
    }

    const form = await request.formData();
    const fileEntries = form.getAll("files");
    if (fileEntries.length === 0) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    const focusRaw = form.get("focus");
    const focus = typeof focusRaw === "string" ? focusRaw.slice(0, 1000) : undefined;

    const raw: RawEntry[] = [];
    for (const item of fileEntries) {
      if (!(item instanceof File)) continue;
      const bytes = new Uint8Array(await item.arrayBuffer());
      raw.push({ path: item.name, bytes });
    }

    const files = filterEntries(raw);
    if (files.length === 0) {
      return NextResponse.json({ error: "No code files were found in that upload." }, { status: 400 });
    }

    const script = await generateScript(files, apiKey, focus);
    if (script.length === 0) {
      return NextResponse.json({ error: "The script came back empty after validation. Try again." }, { status: 500 });
    }

    const turnsWithCode = script.map((turn: Turn) => {
      const source = files.find((f: CodeFile) => f.path === turn.codeRef.path);
      return {
        ...turn,
        snippet: source ? sliceCodeRef(source, turn.codeRef.startLine, turn.codeRef.endLine) : "",
      };
    });

    return NextResponse.json({ turns: turnsWithCode });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
