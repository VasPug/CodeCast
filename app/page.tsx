"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThemedToken } from "shiki";
import { highlight, languageFromPath } from "../lib/highlight";
import {
  deletePodcast,
  getPodcast,
  listPodcasts,
  newPodcastId,
  savePodcast,
  type PodcastSummary,
  type StoredTurn,
} from "../lib/storage";

type Turn = {
  speaker: "A" | "B";
  text: string;
  codeRef: { path: string; startLine: number; endLine: number };
  snippet: string;
};

type AudioTurn = Turn & { audioUrl: string; durationMs: number };

type Phase =
  | { kind: "idle" }
  | { kind: "analyzing" }
  | { kind: "synthesizing"; done: number; total: number }
  | { kind: "ready"; turns: AudioTurn[] }
  | { kind: "error"; message: string };

type PickedFile = { file: File; path: string };

const SPEEDS = [1, 1.25, 1.5, 2];

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [focus, setFocus] = useState("");
  const [saved, setSaved] = useState<PodcastSummary[]>([]);

  const refreshSaved = useCallback(() => {
    listPodcasts()
      .then(setSaved)
      .catch(() => {
        /* ignore — storage is best-effort */
      });
  }, []);

  useEffect(() => {
    refreshSaved();
  }, [refreshSaved]);

  async function handleGenerate() {
    if (picked.length === 0) return;
    setPhase({ kind: "analyzing" });

    try {
      const fd = new FormData();
      for (const { file, path } of picked) {
        fd.append("files", file, path);
      }
      if (focus.trim().length > 0) fd.append("focus", focus.trim());
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analyze failed");
      const turns: Turn[] = data.turns;

      const synthesized: AudioTurn[] = [];
      const storedTurns: StoredTurn[] = [];
      for (let i = 0; i < turns.length; i++) {
        setPhase({ kind: "synthesizing", done: i, total: turns.length });
        const t = turns[i];
        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: t.text, speaker: t.speaker }),
        });
        const payload = await ttsRes.json();
        if (!ttsRes.ok) throw new Error(payload.error ?? "TTS failed");
        const blob = base64ToBlob(payload.audioBase64, payload.mimeType);
        synthesized.push({ ...t, audioUrl: URL.createObjectURL(blob), durationMs: payload.durationMs });
        storedTurns.push({
          speaker: t.speaker,
          text: t.text,
          codeRef: t.codeRef,
          snippet: t.snippet,
          audioBlob: blob,
          mimeType: payload.mimeType,
          durationMs: payload.durationMs,
        });
      }

      const title = derivePodcastTitle(picked);
      try {
        await savePodcast({
          id: newPodcastId(),
          title,
          createdAt: Date.now(),
          turns: storedTurns,
        });
        refreshSaved();
      } catch {
        /* storage failure shouldn't block playback */
      }

      setPhase({ kind: "ready", turns: synthesized });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setPhase({ kind: "error", message });
    }
  }

  async function handleOpenSaved(id: string) {
    const stored = await getPodcast(id);
    if (!stored) return;
    const hydrated: AudioTurn[] = stored.turns.map((t) => ({
      speaker: t.speaker,
      text: t.text,
      codeRef: t.codeRef,
      snippet: t.snippet,
      audioUrl: URL.createObjectURL(t.audioBlob),
      durationMs: t.durationMs,
    }));
    setPhase({ kind: "ready", turns: hydrated });
  }

  async function handleDeleteSaved(id: string) {
    await deletePodcast(id);
    refreshSaved();
  }

  function reset() {
    if (phase.kind === "ready") {
      for (const t of phase.turns) URL.revokeObjectURL(t.audioUrl);
    }
    setPhase({ kind: "idle" });
    setPicked([]);
    setFocus("");
  }

  if (phase.kind === "ready") {
    return <PodcastView turns={phase.turns} onReset={reset} />;
  }

  return (
    <main style={shellStyle}>
      <header style={headerStyle}>
        <div style={{ fontWeight: 600, letterSpacing: 0.2 }}>CodeCast</div>
      </header>

      {phase.kind === "idle" && (
        <UploadView
          picked={picked}
          onPicked={setPicked}
          focus={focus}
          onFocus={setFocus}
          onGenerate={handleGenerate}
          saved={saved}
          onOpenSaved={handleOpenSaved}
          onDeleteSaved={handleDeleteSaved}
        />
      )}

      {phase.kind === "analyzing" && <Status label="Reading your code and writing the script…" />}

      {phase.kind === "synthesizing" && (
        <Status label={`Synthesizing voices — ${phase.done} of ${phase.total} turns done`} />
      )}

      {phase.kind === "error" && (
        <div style={{ padding: 32 }}>
          <div style={{ color: "#ff6b6b", marginBottom: 16 }}>Error: {phase.message}</div>
          <button onClick={reset}>Try again</button>
        </div>
      )}
    </main>
  );
}

function derivePodcastTitle(picked: PickedFile[]): string {
  if (picked.length === 0) return "Podcast";
  const withFolder = picked.find((p) => p.path.includes("/"));
  if (withFolder) return withFolder.path.split("/")[0];
  if (picked.length === 1) return picked[0].path;
  return `${picked.length} files`;
}

function UploadView({
  picked,
  onPicked,
  focus,
  onFocus,
  onGenerate,
  saved,
  onOpenSaved,
  onDeleteSaved,
}: {
  picked: PickedFile[];
  onPicked: (files: PickedFile[]) => void;
  focus: string;
  onFocus: (value: string) => void;
  onGenerate: () => void;
  saved: PodcastSummary[];
  onOpenSaved: (id: string) => void;
  onDeleteSaved: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items);
    const collected: PickedFile[] = [];
    await Promise.all(
      items.map(async (item) => {
        const entry = item.webkitGetAsEntry?.();
        if (entry) await walkEntry(entry as unknown as FsEntry, "", collected);
        else {
          const f = item.getAsFile();
          if (f) collected.push({ file: f, path: f.name });
        }
      }),
    );
    if (collected.length > 0) onPicked(collected);
  }

  function handleFolderPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (list.length === 0) return;
    onPicked(list.map((file) => ({ file, path: fileRelativePath(file) })));
  }

  function handleFilesPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (list.length === 0) return;
    onPicked([...picked, ...list.map((file) => ({ file, path: file.name }))]);
  }

  const filesLabel = picked.length === 1 ? "1 file" : `${picked.length} files`;
  const hasFolder = picked.some((p) => p.path.includes("/"));
  const rootName = hasFolder ? picked[0].path.split("/")[0] : null;

  return (
    <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "64px 32px 32px", overflow: "auto" }}>
      <div style={{ width: "100%", maxWidth: 560, textAlign: "center" }}>
        <h1 style={{ fontSize: 32, margin: "0 0 8px" }}>Explain my code to me.</h1>
        <p style={{ color: "#9aa3ad", margin: "0 0 32px" }}>
          Pick a folder or a few files. Two AI hosts will walk you through the code while the exact
          snippets show on screen.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            padding: "48px 24px",
            border: `2px dashed ${dragOver ? "#4f46e5" : "#2b2f36"}`,
            borderRadius: 12,
            background: dragOver ? "#14161b" : "#0f1115",
          }}
        >
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: "none" }}
            onChange={handleFolderPick}
          />
          <input
            ref={filesInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFilesPick}
          />

          {picked.length === 0 ? (
            <>
              <div style={{ fontSize: 16, color: "#9aa3ad", marginBottom: 6 }}>Drop a folder or files here</div>
              <div style={{ fontSize: 13, color: "#6a727c", marginBottom: 20 }}>or use the buttons below</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button onClick={() => folderInputRef.current?.click()}>Choose folder</button>
                <button onClick={() => filesInputRef.current?.click()}>Choose files</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ color: "#e6e8eb", fontWeight: 500, marginBottom: 4 }}>
                {rootName ?? filesLabel}
              </div>
              <div style={{ fontSize: 13, color: "#9aa3ad", marginBottom: 20 }}>{filesLabel} ready</div>
              <button onClick={() => onPicked([])}>Clear</button>
            </>
          )}
        </div>

        <div style={{ marginTop: 20, textAlign: "left" }}>
          <label
            htmlFor="focus-input"
            style={{ display: "block", fontSize: 12, color: "#6a727c", letterSpacing: 0.4, marginBottom: 6, textTransform: "uppercase" }}
          >
            Focus (optional)
          </label>
          <textarea
            id="focus-input"
            value={focus}
            onChange={(e) => onFocus(e.target.value.slice(0, 1000))}
            placeholder="e.g. walk through the sorting algorithm, or explain the state management, or focus on how the API endpoints work"
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "#0f1115",
              color: "#e6e8eb",
              border: "1px solid #2b2f36",
              borderRadius: 10,
              resize: "vertical",
              fontFamily: "inherit",
              fontSize: 14,
              lineHeight: 1.4,
            }}
          />
          <div style={{ fontSize: 11, color: "#6a727c", marginTop: 4, textAlign: "right" }}>
            {focus.length} / 1000
          </div>
        </div>

        <button
          className="primary"
          disabled={picked.length === 0}
          onClick={onGenerate}
          style={{ marginTop: 8, padding: "12px 24px", fontSize: 15 }}
        >
          Generate podcast
        </button>

        {saved.length > 0 && (
          <SavedList items={saved} onOpen={onOpenSaved} onDelete={onDeleteSaved} />
        )}
      </div>
    </div>
  );
}

function SavedList({
  items,
  onOpen,
  onDelete,
}: {
  items: PodcastSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div style={{ marginTop: 40, textAlign: "left" }}>
      <div style={{ fontSize: 12, color: "#6a727c", letterSpacing: 0.4, marginBottom: 10, textTransform: "uppercase" }}>
        Past podcasts
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: "#0f1115",
              border: "1px solid #1a1d22",
              borderRadius: 10,
            }}
          >
            <button
              onClick={() => onOpen(p.id)}
              style={{
                flex: 1,
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <div style={{ color: "#e6e8eb", fontSize: 14, marginBottom: 2 }}>{p.title}</div>
              <div style={{ color: "#6a727c", fontSize: 12 }}>
                {formatRelativeDate(p.createdAt)} · {p.turnCount} turns
              </div>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${p.title}"?`)) onDelete(p.id);
              }}
              title="Delete"
              aria-label="Delete"
              style={{
                padding: "6px 10px",
                background: "transparent",
                border: "1px solid #1a1d22",
                color: "#6a727c",
                fontSize: 12,
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function fileRelativePath(file: File): string {
  const anyFile = file as File & { webkitRelativePath?: string };
  return anyFile.webkitRelativePath && anyFile.webkitRelativePath.length > 0
    ? anyFile.webkitRelativePath
    : file.name;
}

type FsFileEntry = { isFile: true; isDirectory: false; file: (cb: (f: File) => void) => void };
type FsDirEntry = {
  isFile: false;
  isDirectory: true;
  createReader: () => { readEntries: (cb: (entries: FsEntry[]) => void) => void };
};
type FsEntry = FsFileEntry | FsDirEntry;

async function walkEntry(entry: FsEntry, prefix: string, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve) => entry.file(resolve));
    out.push({ file, path: prefix ? `${prefix}/${file.name}` : file.name });
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const children: FsEntry[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await new Promise<FsEntry[]>((resolve) => reader.readEntries(resolve));
      if (batch.length === 0) break;
      children.push(...batch);
    }
    const nextPrefix = prefix ? `${prefix}/${(entry as unknown as { name: string }).name}` : (entry as unknown as { name: string }).name;
    await Promise.all(children.map((c) => walkEntry(c, nextPrefix, out)));
  }
}

function Status({ label }: { label: string }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
      <div style={{ textAlign: "center" }}>
        <div className="spinner" style={spinnerStyle} />
        <div style={{ color: "#9aa3ad", marginTop: 16 }}>{label}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function PodcastView({ turns, onReset }: { turns: AudioTurn[]; onReset: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const speed = SPEEDS[speedIdx];

  const { turnOffsets, totalDuration } = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const t of turns) {
      offsets.push(acc);
      acc += (t.durationMs ?? 0) / 1000;
    }
    return { turnOffsets: offsets, totalDuration: acc };
  }, [turns]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.src = turns[currentIdx].audioUrl;
    el.playbackRate = speed;
    el.load();
    setCurrentTime(0);
    if (playingRef.current) el.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, turns]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed]);

  function handleEnded() {
    if (currentIdx < turns.length - 1) setCurrentIdx(currentIdx + 1);
    else setPlaying(false);
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

  function jumpTo(idx: number) {
    if (idx < 0 || idx >= turns.length) return;
    setCurrentIdx(idx);
    setPlaying(true);
  }

  function findTurnAt(globalSeconds: number): { idx: number; localTime: number } {
    const clamped = Math.max(0, Math.min(totalDuration, globalSeconds));
    for (let i = turns.length - 1; i >= 0; i--) {
      if (clamped >= turnOffsets[i]) {
        return { idx: i, localTime: clamped - turnOffsets[i] };
      }
    }
    return { idx: 0, localTime: 0 };
  }

  function seekGlobal(globalSeconds: number) {
    const { idx, localTime } = findTurnAt(globalSeconds);
    if (idx === currentIdx) {
      const el = audioRef.current;
      if (el) el.currentTime = localTime;
      setCurrentTime(localTime);
    } else {
      pendingSeekRef.current = localTime;
      setCurrentIdx(idx);
    }
  }

  function rewind10() {
    seekGlobal(globalTime() - 10);
  }

  function forward10() {
    seekGlobal(globalTime() + 10);
  }

  function globalTime(): number {
    return turnOffsets[currentIdx] + (audioRef.current?.currentTime ?? currentTime);
  }

  function cycleSpeed() {
    setSpeedIdx((speedIdx + 1) % SPEEDS.length);
  }

  function handleTimeUpdate() {
    const el = audioRef.current;
    if (!el || scrub !== null) return;
    setCurrentTime(el.currentTime);
  }

  function handleLoadedMetadata() {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
    if (pendingSeekRef.current !== null) {
      el.currentTime = pendingSeekRef.current;
      setCurrentTime(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
  }

  function handleSeekInput(e: React.ChangeEvent<HTMLInputElement>) {
    setScrub(Number(e.target.value));
  }

  function handleSeekCommit(e: React.FormEvent<HTMLInputElement>) {
    const value = Number((e.currentTarget as HTMLInputElement).value);
    setScrub(null);
    seekGlobal(value);
  }

  const current = turns[currentIdx];
  const prev = currentIdx > 0 ? turns[currentIdx - 1] : null;
  const next = currentIdx < turns.length - 1 ? turns[currentIdx + 1] : null;
  const globalDisplay = scrub ?? (turnOffsets[currentIdx] + currentTime);

  return (
    <main style={shellStyle}>
      <header style={headerStyle}>
        <div style={{ fontWeight: 600, letterSpacing: 0.2 }}>CodeCast</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="icon-btn"
            onClick={rewind10}
            title="Rewind 10 seconds"
            aria-label="Rewind 10 seconds"
          >
            <Rewind10Icon />
          </button>
          <button
            className="icon-btn play"
            onClick={togglePlay}
            title={playing ? "Pause" : "Play"}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            className="icon-btn"
            onClick={forward10}
            title="Forward 10 seconds"
            aria-label="Forward 10 seconds"
          >
            <Forward10Icon />
          </button>
          <button
            className={`pill ${speed !== 1 ? "active" : ""}`}
            onClick={cycleSpeed}
            title="Playback speed"
            style={{ marginLeft: 8, minWidth: 48, justifyContent: "center" }}
          >
            {speed}×
          </button>
        </div>

        <div style={{ justifySelf: "end" }}>
          <button
            className="icon-btn"
            onClick={onReset}
            title="Home"
            aria-label="Home"
          >
            <HomeIcon />
          </button>
        </div>
      </header>

      <div style={gridStyle}>
        <TranscriptFocus
          prev={prev}
          current={current}
          next={next}
          idx={currentIdx}
          total={turns.length}
          onPrev={() => jumpTo(currentIdx - 1)}
          onNext={() => jumpTo(currentIdx + 1)}
        />
        <CodeViewer turn={current} />
      </div>

      <div style={seekBarStyle}>
        <div style={timeTextStyle}>{formatTime(globalDisplay)}</div>
        <input
          className="seek"
          type="range"
          min={0}
          max={totalDuration || 0}
          step={0.1}
          value={Math.min(globalDisplay, totalDuration || 0)}
          onChange={handleSeekInput}
          onMouseUp={handleSeekCommit}
          onTouchEnd={handleSeekCommit}
          onKeyUp={handleSeekCommit}
        />
        <div style={timeTextStyle}>{formatTime(totalDuration)}</div>
        <div style={{ color: "#9aa3ad", fontSize: 12, minWidth: 140, textAlign: "right" }}>
          Turn {currentIdx + 1} / {turns.length} · {current.speaker === "A" ? "Alex" : "Jordan"}
        </div>
      </div>

      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        preload="auto"
        style={{ display: "none" }}
      />
    </main>
  );
}

function TranscriptFocus({
  prev,
  current,
  next,
  idx,
  total,
  onPrev,
  onNext,
}: {
  prev: AudioTurn | null;
  current: AudioTurn;
  next: AudioTurn | null;
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={transcriptStyle}>
      {prev && (
        <div
          onClick={onPrev}
          style={{ ...turnRowStyle, opacity: 0.35, cursor: "pointer", fontSize: 14 }}
        >
          <SpeakerLabel speaker={prev.speaker} small />
          <div style={{ lineHeight: 1.5, marginTop: 4 }}>{truncate(prev.text, 120)}</div>
        </div>
      )}

      <div
        key={idx}
        style={{
          ...turnRowStyle,
          fontSize: 20,
          animation: "fadeIn 280ms ease",
        }}
      >
        <SpeakerLabel speaker={current.speaker} />
        <div style={{ lineHeight: 1.55, marginTop: 10, color: "#e6e8eb" }}>{current.text}</div>
        <div style={{ color: "#6a727c", fontSize: 12, marginTop: 16 }}>
          {idx + 1} of {total}
        </div>
      </div>

      {next && (
        <div
          onClick={onNext}
          style={{ ...turnRowStyle, opacity: 0.35, cursor: "pointer", fontSize: 14 }}
        >
          <SpeakerLabel speaker={next.speaker} small />
          <div style={{ lineHeight: 1.5, marginTop: 4 }}>{truncate(next.text, 120)}</div>
        </div>
      )}

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}

function SpeakerLabel({ speaker, small }: { speaker: "A" | "B"; small?: boolean }) {
  const name = speaker === "A" ? "Alex" : "Jordan";
  const color = speaker === "A" ? "#8b93ff" : "#6ee7b7";
  return (
    <div style={{ fontSize: small ? 11 : 12, color, fontWeight: 600, letterSpacing: 0.4 }}>
      {name.toUpperCase()}
    </div>
  );
}

function CodeViewer({ turn }: { turn: AudioTurn }) {
  const lang = useMemo(() => languageFromPath(turn.codeRef.path), [turn.codeRef.path]);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlight(turn.snippet, lang).then((t) => {
      if (!cancelled) setTokens(t);
    });
    return () => {
      cancelled = true;
    };
  }, [turn.snippet, lang]);

  const plainLines = useMemo(() => turn.snippet.split("\n"), [turn.snippet]);

  return (
    <div style={codePanelStyle}>
      <div style={codeHeaderStyle}>
        <span className="pill" style={{ cursor: "default" }}>{turn.codeRef.path}</span>
        <span style={{ color: "#6a727c", fontSize: 12 }}>
          lines {turn.codeRef.startLine}–{turn.codeRef.endLine}
        </span>
      </div>
      <pre style={codePreStyle}>
        {tokens
          ? tokens.map((line, i) => (
              <div key={i} className="shiki-line">
                <span className="shiki-gutter">{turn.codeRef.startLine + i}</span>
                <span className="shiki-content">
                  {line.length === 0 ? (
                    " "
                  ) : (
                    line.map((tok, j) => (
                      <span key={j} style={{ color: tok.color }}>
                        {tok.content}
                      </span>
                    ))
                  )}
                </span>
              </div>
            ))
          : plainLines.map((line, i) => (
              <div key={i} className="shiki-line">
                <span className="shiki-gutter">{turn.codeRef.startLine + i}</span>
                <span className="shiki-content">{line || " "}</span>
              </div>
            ))}
      </pre>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        d="M12 3.2 3 10.5V20a1 1 0 0 0 1 1h5v-6h6v6h5a1 1 0 0 0 1-1v-9.5l-9-7.3z"
        fill="currentColor"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
    </svg>
  );
}

function Rewind10Icon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"
        fill="currentColor"
      />
      <text x="11" y="19" fontSize="8" fontWeight="700" fill="currentColor" textAnchor="middle" fontFamily="ui-sans-serif, system-ui">
        10
      </text>
    </svg>
  );
}

function Forward10Icon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        d="M12 5V2l5 4-5 4V7a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z"
        fill="currentColor"
      />
      <text x="13" y="19" fontSize="8" fontWeight="700" fill="currentColor" textAnchor="middle" fontFamily="ui-sans-serif, system-ui">
        10
      </text>
    </svg>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

const shellStyle: React.CSSProperties = {
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  padding: "12px 24px",
  borderBottom: "1px solid #1a1d22",
  gap: 16,
};

const gridStyle: React.CSSProperties = {
  flex: 1,
  display: "grid",
  gridTemplateColumns: "minmax(320px, 42%) 1fr",
  gap: 1,
  background: "#1a1d22",
  minHeight: 0,
};

const transcriptStyle: React.CSSProperties = {
  background: "#0b0d10",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-start",
  alignItems: "stretch",
  padding: "40px 48px",
  overflow: "auto",
  gap: 24,
};

const turnRowStyle: React.CSSProperties = {
  transition: "opacity 200ms ease",
};

const codePanelStyle: React.CSSProperties = {
  background: "#0b0d10",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};

const codeHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  borderBottom: "1px solid #1a1d22",
};

const codePreStyle: React.CSSProperties = {
  flex: 1,
  margin: 0,
  padding: "16px 0",
  overflow: "auto",
  fontSize: 13,
  lineHeight: 1.55,
};

const seekBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 24px",
  borderTop: "1px solid #1a1d22",
};

const timeTextStyle: React.CSSProperties = {
  color: "#9aa3ad",
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  minWidth: 40,
};

const spinnerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  border: "3px solid #2b2f36",
  borderTopColor: "#4f46e5",
  borderRadius: "50%",
  animation: "spin 800ms linear infinite",
  margin: "0 auto",
};
