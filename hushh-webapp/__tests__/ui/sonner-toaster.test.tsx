import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const sonnerPropsSpy = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    sonnerPropsSpy(props);
    return <div data-testid="sonner-root" />;
  },
}));

import { Toaster } from "@/components/ui/sonner";

describe("App Toaster wiring", () => {
  beforeEach(() => {
    sonnerPropsSpy.mockClear();
  });

  it("forwards explicit placement and dismiss props", () => {
    render(<Toaster position="top-center" closeButton />);

    expect(sonnerPropsSpy).toHaveBeenCalledTimes(1);
    const props = sonnerPropsSpy.mock.calls[0][0] as Record<string, unknown>;

    expect(props.position).toBe("top-center");
    expect(props.closeButton).toBe(true);
  });
});
