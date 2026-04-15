import { describe, it, expect } from "vitest";
import { filterEntries } from "./codeExtractor";

function entry(path: string, content: string | Uint8Array) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { path, bytes };
}

describe("filterEntries", () => {
  it("skips node_modules, .git, and binary files", () => {
    const files = filterEntries([
      entry("src/app.tsx", "export const App = () => <div/>;"),
      entry("node_modules/react/index.js", "module.exports = {};"),
      entry(".git/HEAD", "ref: refs/heads/main"),
      entry("assets/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
      entry("README.md", "# hi"),
    ]);
    const paths = files.map((f) => f.path);

    expect(paths).toContain("src/app.tsx");
    expect(paths).toContain("README.md");
    expect(paths).not.toContain("node_modules/react/index.js");
    expect(paths).not.toContain(".git/HEAD");
    expect(paths).not.toContain("assets/logo.png");
  });

  it("drops files over the size limit", () => {
    const huge = "x".repeat(300_000);
    const files = filterEntries([
      entry("src/huge.ts", huge),
      entry("src/small.ts", "export const x = 1;"),
    ]);
    const paths = files.map((f) => f.path);

    expect(paths).toContain("src/small.ts");
    expect(paths).not.toContain("src/huge.ts");
  });

  it("strips a single top-level wrapper directory", () => {
    const files = filterEntries([
      entry("my-project/src/app.tsx", "export {}"),
      entry("my-project/package.json", "{}"),
    ]);
    const paths = files.map((f) => f.path);

    expect(paths).toContain("src/app.tsx");
    expect(paths).toContain("package.json");
  });

  it("does not strip common source directory names", () => {
    const files = filterEntries([
      entry("src/a.ts", "a"),
      entry("src/b.ts", "b"),
    ]);
    const paths = files.map((f) => f.path);

    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
