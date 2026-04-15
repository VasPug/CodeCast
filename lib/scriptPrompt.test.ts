import { describe, it, expect } from "vitest";
import { validateScript, type CodeFile, type Script } from "./scriptPrompt";

const files: CodeFile[] = [
  {
    path: "src/app.tsx",
    content: [
      "import React from 'react';",
      "",
      "export function App() {",
      "  return <div>hello</div>;",
      "}",
    ].join("\n"),
  },
];

describe("validateScript", () => {
  it("keeps turns whose codeRef points to real lines", () => {
    const script: Script = [
      { speaker: "A", text: "Let's look at the App component.", codeRef: { path: "src/app.tsx", startLine: 3, endLine: 5 } },
      { speaker: "B", text: "It renders a single div.", codeRef: { path: "src/app.tsx", startLine: 4, endLine: 4 } },
    ];

    const result = validateScript(script, files);
    expect(result).toHaveLength(2);
  });

  it("drops turns whose file does not exist", () => {
    const script: Script = [
      { speaker: "A", text: "ok", codeRef: { path: "src/app.tsx", startLine: 1, endLine: 1 } },
      { speaker: "B", text: "fake", codeRef: { path: "src/missing.ts", startLine: 1, endLine: 1 } },
    ];

    const result = validateScript(script, files);
    expect(result).toHaveLength(1);
    expect(result[0].codeRef.path).toBe("src/app.tsx");
  });

  it("drops turns whose line range exceeds file length", () => {
    const script: Script = [
      { speaker: "A", text: "ok", codeRef: { path: "src/app.tsx", startLine: 1, endLine: 5 } },
      { speaker: "B", text: "too far", codeRef: { path: "src/app.tsx", startLine: 1, endLine: 999 } },
    ];

    const result = validateScript(script, files);
    expect(result).toHaveLength(1);
  });

  it("drops turns with inverted line ranges", () => {
    const script: Script = [
      { speaker: "A", text: "bad", codeRef: { path: "src/app.tsx", startLine: 4, endLine: 2 } },
    ];

    expect(validateScript(script, files)).toHaveLength(0);
  });
});
