export type CodeFile = { path: string; content: string };
export type RawEntry = { path: string; bytes: Uint8Array };

const MAX_FILE_BYTES = 200_000;
const TOTAL_CHAR_BUDGET = 60_000;

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "cc", "cpp", "h", "hpp",
  "cs", "php", "scala", "sh", "bash", "zsh",
  "sql", "html", "css", "scss", "vue", "svelte",
  "json", "yaml", "yml", "toml",
  "md", "txt",
]);

const SKIP_DIRS = [
  "node_modules/", ".git/", ".next/", "dist/", "build/",
  ".venv/", "venv/", "__pycache__/", ".idea/", ".vscode/",
  "target/", ".gradle/", "vendor/", ".cache/",
];

const NEVER_STRIP = new Set([
  "src", "lib", "app", "apps", "pages", "components", "hooks", "utils",
  "test", "tests", "spec", "docs", "public", "static", "assets",
  "dist", "build", "out", "bin", "scripts", "api", "server", "client",
]);

function isBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 512);
  for (let i = 0; i < limit; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32 && b !== 27)) return true;
  }
  return false;
}

function hasCodeExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return CODE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

function normalizePath(path: string): string {
  return path.replace(/^\.?\/+/, "").replace(/\\/g, "/");
}

function detectWrapperDir(allPaths: string[]): string {
  if (allPaths.length === 0) return "";
  const topLevels = new Set<string>();
  for (const p of allPaths) {
    const slash = p.indexOf("/");
    topLevels.add(slash === -1 ? p : p.slice(0, slash));
    if (topLevels.size > 1) return "";
  }
  const [only] = topLevels;
  if (!only || NEVER_STRIP.has(only.toLowerCase())) return "";
  return allPaths.every((p) => p.startsWith(`${only}/`)) ? `${only}/` : "";
}

export function filterEntries(entries: RawEntry[]): CodeFile[] {
  const normalized = entries.map((e) => ({ ...e, path: normalizePath(e.path) }));
  const wrapper = detectWrapperDir(normalized.map((e) => e.path));

  const out: CodeFile[] = [];
  for (const entry of normalized) {
    const { path, bytes } = entry;
    if (SKIP_DIRS.some((d) => path.includes(d))) continue;
    if (path.split("/").some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..")) continue;
    if (!hasCodeExtension(path)) continue;
    if (bytes.byteLength > MAX_FILE_BYTES) continue;
    if (isBinary(bytes)) continue;
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const finalPath = wrapper && path.startsWith(wrapper) ? path.slice(wrapper.length) : path;
    out.push({ path: finalPath, content });
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function packFilesForPrompt(files: CodeFile[]): string {
  let total = 0;
  const parts: string[] = [];
  for (const f of files) {
    const header = `\n===== FILE: ${f.path} =====\n`;
    const lineNumbered = f.content
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(4, " ")}| ${line}`)
      .join("\n");
    const block = header + lineNumbered + "\n";
    if (total + block.length > TOTAL_CHAR_BUDGET) break;
    parts.push(block);
    total += block.length;
  }
  return parts.join("");
}
