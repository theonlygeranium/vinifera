// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FormFeedback } from "../../src/client/shared/FormFeedback";

describe("FormFeedback", () => {
  afterEach(() => cleanup());

  it("renders nothing when the message is empty", () => {
    const { container, rerender } = render(<FormFeedback message={null} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<FormFeedback message="" kind="success" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("preserves urgent and polite feedback semantics", () => {
    const { rerender } = render(<FormFeedback message="Save failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed");

    rerender(<FormFeedback message="Saved" kind="success" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});
