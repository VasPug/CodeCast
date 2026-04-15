import { codeToTokens, type BundledLanguage, type ThemedToken } from "shiki";

const EXT_TO_LANG: Record<string, BundledLanguage> = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  php: "php",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  toml: "toml",
  xml: "xml",
};

export type HighlightLang = BundledLanguage | "text";

export function languageFromPath(path: string): HighlightLang {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "text";
}

const cache = new Map<string, Promise<ThemedToken[][]>>();

export function highlight(code: string, lang: HighlightLang): Promise<ThemedToken[][]> {
  const key = `${lang}::${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const run = codeToTokens(code, { lang, theme: "github-dark" }).then(
    (r) => r.tokens,
    () => fallbackTokens(code),
  );
  cache.set(key, run);
  return run;
}

function fallbackTokens(code: string): ThemedToken[][] {
  return code.split("\n").map((line) => [{ content: line || " ", offset: 0 }]);
}
