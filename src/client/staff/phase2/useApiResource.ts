import { useCallback, useEffect, useRef, useState } from "react";

export type ResourceState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: unknown };

export function useApiResource<T>(
  load: () => Promise<T>,
  dependencies: readonly unknown[],
) {
  const generation = useRef(0);
  const [state, setState] = useState<ResourceState<T>>({
    status: "loading",
    data: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    setState({ status: "loading", data: null, error: null });
    try {
      const data = await load();
      if (generation.current === requestGeneration) {
        setState({ status: "ready", data, error: null });
      }
      return data;
    } catch (error) {
      if (generation.current === requestGeneration) {
        setState({ status: "error", data: null, error });
      }
      return null;
    }
    // The caller explicitly controls when its loader changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  return { state, refresh };
}
