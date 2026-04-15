import OpenAI from "openai";
import { packFilesForPrompt, type CodeFile } from "./codeExtractor";

export type { CodeFile };

export type Turn = {
  speaker: "A" | "B";
  text: string;
  codeRef: { path: string; startLine: number; endLine: number };
};

export type Script = Turn[];

const SYSTEM_PROMPT = `You are writing a short, friendly two-host podcast that walks a student through their own coding project so they actually understand how it works and can explain it to a teacher afterwards.

The hosts:
- Alex (speaker A) is the guide. Explains what the code is doing, points to specific lines, connects the pieces, and answers the "why".
- Jordan (speaker B) is the curious collaborator. Asks the questions a learner would ask, paraphrases Alex to check understanding, and raises "what if" or "why not X" to draw out tradeoffs.
Both can occasionally swap roles, but Jordan should more often be the one asking.

Structure the conversation (8 to 12 turns total, alternating A and B):
1. Open with one or two sentences on what the project does at a high level.
2. Show the entry point and describe the overall control flow — what calls what, how data moves through it.
3. Spend most of the script (4 to 6 turns) on 2 or 3 pieces of the code that are interesting, subtle, or easy to get wrong — the parts a teacher is most likely to ask about.
4. Wrap up in one turn, tying the pieces back to the main goal.

If the user provides a FOCUS note at the top of the source, treat it as the student's request for what the podcast should emphasize — pick the pieces of code that relate to that focus and spend more of the script there, while still covering entry point, flow, and wrap-up. If the note is empty or missing, choose the most teaching-worthy pieces yourself.

How to actually teach while you do this:
- Explain the WHY, not just the WHAT. Narrating what the code literally says is boring. Explain why this data structure, this loop shape, this library, this order of operations makes sense here.
- Define jargon the first time it appears (words like "closure", "promise", "recursion", "mutation", "idempotent") in plain language, briefly.
- Use Socratic moments. Jordan can ask things like "what happens if the input is empty?" or "why not a plain for loop here?" and Alex answers by pointing at the code.
- Flag the subtle stuff a student is likely to miss: off-by-one edges, mutation vs. copy, async ordering, implicit type coercion, hidden side effects, error paths.
- When it helps, name the underlying concept ("this is recursion", "this is how state flows", "this is the classic producer/consumer pattern") so the student can connect the code to what they've been taught.
- Be kind. Acknowledge what the code does well. If something is rough, frame it as "here's a cleaner way to think about it", not a critique of the student.
- End at least once with a small nudge the student could try on their own — "trace it with an empty list", "change N and watch what happens", "what would break if this were called twice?".

Hard rules (do not break):
- Every turn MUST reference a specific code region via codeRef { path, startLine, endLine } that matches what the speaker is discussing in THAT turn. Line numbers refer to the "NNNN| " prefix shown in the source. The range must exist in the file.
- Only reference code that actually appears in the source provided. Do not invent files, functions, or behavior. If something is ambiguous, reason from what is visible.
- Each turn is 1 to 3 sentences — conversational, not a lecture. Natural reactions ("right", "oh, okay") are fine in moderation.
- Plain text only — no markdown, no emojis, no stage directions like "[laughs]".`;

const SCHEMA = {
  type: "object",
  properties: {
    turns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["A", "B"] },
          text: { type: "string" },
          codeRef: {
            type: "object",
            properties: {
              path: { type: "string" },
              startLine: { type: "integer" },
              endLine: { type: "integer" },
            },
            required: ["path", "startLine", "endLine"],
            additionalProperties: false,
          },
        },
        required: ["speaker", "text", "codeRef"],
        additionalProperties: false,
      },
    },
  },
  required: ["turns"],
  additionalProperties: false,
} as const;

export async function generateScript(
  files: CodeFile[],
  apiKey: string,
  focus?: string,
): Promise<Script> {
  if (files.length === 0) throw new Error("No code files were found in the upload.");

  const client = new OpenAI({ apiKey });
  const packed = packFilesForPrompt(files);
  const focusBlock = focus && focus.trim().length > 0
    ? `FOCUS (from the student):\n${focus.trim()}\n\n`
    : "";

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${focusBlock}Here is the project source. Write the podcast script.\n${packed}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "podcast_script", schema: SCHEMA, strict: true },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned an empty response.");

  const parsed = JSON.parse(raw) as { turns: Script };
  return validateScript(parsed.turns, files);
}

export function validateScript(turns: Script, files: CodeFile[]): Script {
  const byPath = new Map(files.map((f) => [f.path, f.content.split("\n").length]));
  return turns.filter((t) => {
    const total = byPath.get(t.codeRef.path);
    if (total === undefined) return false;
    const { startLine, endLine } = t.codeRef;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return false;
    if (startLine < 1 || endLine < startLine) return false;
    if (endLine > total) return false;
    return true;
  });
}

export function sliceCodeRef(file: CodeFile, startLine: number, endLine: number): string {
  const lines = file.content.split("\n");
  return lines.slice(startLine - 1, endLine).join("\n");
}
