import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/morphy-ux/streaming-accordion", () => ({
  StreamingAccordion: ({
    text,
    autoCollapseOnComplete,
  }: {
    text: string;
    autoCollapseOnComplete?: boolean;
  }) => (
    <div data-testid="streaming-accordion" data-auto-collapse={String(autoCollapseOnComplete)}>
      {text}
    </div>
  ),
}));

import { StreamingProgressView } from "@/components/kai/views/streaming-progress-view";

describe("StreamingProgressView reasoning behavior", () => {
  it("keeps reasoning expanded behavior by disabling auto-collapse on complete", () => {
    render(
      <StreamingProgressView
        stage="complete"
        title="Fundamental"
        streamedText="SENTINEL_REASONING_TEXT"
        compactMode
      />
    );

    const accordion = screen.getByTestId("streaming-accordion");
    expect(accordion.getAttribute("data-auto-collapse")).toBe("false");
  });

  it("renders reasoning text once (no duplicate post-completion block)", () => {
    render(
      <StreamingProgressView
        stage="complete"
        title="Valuation"
        streamedText="UNIQUE_REASONING_SENTINEL"
        compactMode
      />
    );

    expect(screen.getAllByText("UNIQUE_REASONING_SENTINEL")).toHaveLength(1);
  });
});
