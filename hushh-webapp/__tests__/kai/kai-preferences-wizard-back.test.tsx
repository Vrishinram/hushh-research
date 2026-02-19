import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { KaiPreferencesWizard } from "@/components/kai/onboarding/KaiPreferencesWizard";

describe("KaiPreferencesWizard back behavior", () => {
  it("hides back button on step 1 in onboarding mode", () => {
    const onBack = vi.fn();

    render(
      <KaiPreferencesWizard
        mode="onboarding"
        layout="page"
        onBack={onBack}
        onComplete={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("moves to previous step from step 2 without exiting", () => {
    const onBack = vi.fn();

    render(
      <KaiPreferencesWizard
        mode="onboarding"
        layout="page"
        onBack={onBack}
        onComplete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("3–7 years"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(
      screen.getByText(/If your portfolio drops 20%, what/i)
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(
      screen.getByText(/How long do you expect to keep/i)
    ).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
  });
});
