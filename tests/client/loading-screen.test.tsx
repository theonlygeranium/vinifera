// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingScreen } from "../../src/client/shared/LoadingScreen";

describe("LoadingScreen", () => {
  afterEach(() => cleanup());

  it("announces its visible label as a polite status", () => {
    render(<LoadingScreen label="Loading member portal" />);

    const main = screen.getByRole("main");
    expect(main).not.toHaveAttribute("aria-live");
    expect(main).not.toHaveAttribute("aria-busy");
    expect(screen.getByLabelText("Loading member portal in progress")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading member portal…",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
