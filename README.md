# CodeCast

Drop in a folder of your code, get a two-host podcast explaining it — with the actual code snippets on screen as the hosts talk.

## Setup

1. `cp .env.local.example .env.local`
2. Fill in:
   - `OPENAI_API_KEY` — any OpenAI key (uses `gpt-4o-mini`)
   - `ELEVENLABS_API_KEY` — from https://elevenlabs.io/app/settings/api-keys
   - `ELEVENLABS_VOICE_A` / `ELEVENLABS_VOICE_B` — two voice IDs from the ElevenLabs Voice Library
3. `npm install && npm run dev`
4. Open http://localhost:3000

## How it works

1. You drop a folder (or pick files) and optionally give a focus (e.g. "explain the sorting algorithm").
2. Server filters to code files, hands them to OpenAI.
3. OpenAI returns a structured script: 8–12 turns, each with a `codeRef` pointing to real lines.
4. Server synthesizes each turn with ElevenLabs (voice A or B) and returns MP3s with durations.
5. Player plays audio sequentially; right pane shows the syntax-highlighted snippet for the current turn. Seek bar spans the whole podcast; past podcasts are stored locally in IndexedDB.

## Cost per podcast

- OpenAI: ~$0.02
- ElevenLabs: ~$0.10–0.30 depending on length

## Testing

`npm test` — covers the code extractor and script validator.
