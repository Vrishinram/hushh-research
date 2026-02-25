import { describe, expect, it } from "vitest";

import {
  getInitialRoundCollapseState,
  getRoundCollapseStateForDecision,
  getRoundCollapseStateForRound,
} from "@/components/kai/debate-stream-state";

describe("debate round collapse policy", () => {
  it("starts with round 1 open and round 2 collapsed", () => {
    expect(getInitialRoundCollapseState()).toEqual({ 1: false, 2: true });
  });

  it("opens round 2 and collapses round 1 on round transition", () => {
    expect(getRoundCollapseStateForRound(2)).toEqual({ 1: true, 2: false });
  });

  it("keeps round 1 collapsed and round 2 open at decision", () => {
    expect(getRoundCollapseStateForDecision()).toEqual({ 1: true, 2: false });
  });
});
