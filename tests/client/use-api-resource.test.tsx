// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { useCallback } from "react";
import { describe, expect, it } from "vitest";
import { useApiResource } from "../../src/client/staff/phase2/useApiResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function Probe({ load }: { load: () => Promise<string> }) {
  const stableLoad = useCallback(load, [load]);
  const resource = useApiResource(stableLoad, [stableLoad]);
  return (
    <span data-testid="resource">
      {resource.state.status === "ready"
        ? resource.state.data
        : resource.state.status}
    </span>
  );
}

describe("useApiResource request generations", () => {
  it("does not let an older response overwrite the active dependency result", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { rerender } = render(<Probe load={() => first.promise} />);

    rerender(<Probe load={() => second.promise} />);
    await act(async () => second.resolve("brand-b"));
    expect(screen.getByTestId("resource")).toHaveTextContent("brand-b");

    await act(async () => first.resolve("brand-a"));
    expect(screen.getByTestId("resource")).toHaveTextContent("brand-b");
  });
});
