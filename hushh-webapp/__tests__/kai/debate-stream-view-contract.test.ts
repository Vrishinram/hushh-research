import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("DebateStreamView startup contract", () => {
  it("removes initializing loader copy and preserves decision placeholder copy", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/kai/debate-stream-view.tsx"),
      "utf-8"
    );

    expect(source).not.toContain("Connecting to agents...");
    expect(source).not.toContain("Initializing...");
    expect(source).toContain("Final recommendation is building...");
    expect(source).toContain(
      "Debate rounds are streaming on the left. Decision card appears here as soon as a terminal decision event arrives."
    );
  });
});
