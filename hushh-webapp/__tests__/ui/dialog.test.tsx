import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

describe("DialogContent", () => {
  it("renders the close button by default", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Test dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();
  });

  it("hides the close button when showCloseButton is false", () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Test dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });
});

describe("DialogHeader", () => {
  it("renders with data-slot='dialog-header'", () => {
    const { container } = render(<DialogHeader>Header content</DialogHeader>);

    expect(
      container.querySelector('[data-slot="dialog-header"]'),
    ).toBeTruthy();
  });
});

describe("DialogFooter", () => {
  it("renders with data-slot='dialog-footer'", () => {
    const { container } = render(<DialogFooter>Footer content</DialogFooter>);

    expect(
      container.querySelector('[data-slot="dialog-footer"]'),
    ).toBeTruthy();
  });
});