import {
  createContext,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface RouterLocation {
  pathname: string;
  search: string;
  state: unknown;
}

interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

interface RouterValue {
  location: RouterLocation;
  navigate: (to: string, options?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function readLocation(): RouterLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    state: window.history.state,
  };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<RouterLocation>(readLocation);

  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const target = new URL(to, window.location.origin);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.toString());
      return;
    }

    const destination = `${target.pathname}${target.search}${target.hash}`;
    if (options.replace) {
      window.history.replaceState(options.state ?? null, "", destination);
    } else {
      window.history.pushState(options.state ?? null, "", destination);
    }
    setLocation(readLocation());
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRouter must be used within RouterProvider");
  return context;
}

interface LinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
}

export function Link({ to, onClick, target, children, ...props }: LinkProps) {
  const { navigate } = useRouter();

  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target === "_blank"
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }

  return (
    <a {...props} href={to} target={target} onClick={follow}>
      {children}
    </a>
  );
}

export function Redirect({
  to,
  state,
}: {
  to: string;
  state?: unknown;
}) {
  const { navigate } = useRouter();

  useEffect(() => {
    navigate(to, { replace: true, state });
  }, [navigate, state, to]);

  return null;
}

export function useSearchParams() {
  const { location } = useRouter();
  return useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
}
