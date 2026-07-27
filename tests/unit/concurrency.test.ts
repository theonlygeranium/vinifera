import { describe, expect, it, vi } from "vitest";
import { mapConcurrent } from "../../server/lib/concurrency";

describe("mapConcurrent", () => {
  it("rejects non-positive and non-integer concurrency", async () => {
    for (const concurrency of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        mapConcurrent([1], concurrency, async (value) => value),
      ).rejects.toThrow(
        new RangeError("concurrency must be a positive integer"),
      );
    }
  });

  it("processes undefined values and preserves input ordering", async () => {
    const operation = vi.fn(async (value: number | undefined) =>
      value === undefined ? "missing" : `value-${value}`,
    );

    await expect(
      mapConcurrent([1, undefined, 3], 2, operation),
    ).resolves.toEqual(["value-1", "missing", "value-3"]);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(operation).toHaveBeenCalledWith(undefined);
  });
});
