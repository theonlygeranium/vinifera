import {
  Fragment,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  apiRequest,
  readActiveBrandId,
  writeActiveBrandId,
} from "../../api/client";
import type { Brand } from "../../api/phase5";
import { useRouter } from "../../routes/router";
import { LoadingScreen } from "../../shared/LoadingScreen";
import { ErrorBlock } from "../../shared/OperationalState";

type BrandScopeStatus = "loading" | "ready" | "activation_required" | "error";

interface BrandScopeValue {
  status: BrandScopeStatus;
  error: unknown;
  brands: Brand[];
  activeBrandId: string | "all" | null;
  activeBrand: Brand | null;
  setActiveBrandId: (brandId: string) => void;
  canViewAllBrands: boolean;
  refresh: () => Promise<void>;
}

const BrandScopeContext = createContext<BrandScopeValue | null>(null);

function permitsAllBrandScope(pathname: string) {
  return pathname === "/app/brands" || pathname === "/app/analytics";
}

export function BrandScopeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BrandScopeStatus>("loading");
  const [error, setError] = useState<unknown>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [canViewAllBrands, setCanViewAllBrands] = useState(false);
  const [activeBrandId, setActiveBrandState] = useState<string | "all" | null>(
    readActiveBrandId,
  );
  const { location, navigate } = useRouter();

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await apiRequest<{
        items: Brand[];
        canViewAllBrands: boolean;
      }>("/api/brands");
      const nextBrands = response.items;
      const stored = readActiveBrandId();
      const requestedAll =
        response.canViewAllBrands &&
        permitsAllBrandScope(window.location.pathname) &&
        new URLSearchParams(window.location.search).get("scope") === "all";
      const next = requestedAll
        ? "all"
        : (nextBrands.find((brand) => brand.id === stored)?.id ??
          nextBrands.find((brand) => brand.isDefault)?.id ??
          nextBrands[0]?.id ??
          null);
      setBrands(nextBrands);
      setCanViewAllBrands(response.canViewAllBrands);
      setActiveBrandState(next);
      writeActiveBrandId(next === "all" ? null : next);
      setStatus(nextBrands.length ? "ready" : "activation_required");
    } catch (caught) {
      const activation =
        caught instanceof Error &&
        "code" in caught &&
        (caught as { code?: string }).code?.toUpperCase() ===
          "ACTIVATION_REQUIRED";
      setError(caught);
      setStatus(activation ? "activation_required" : "error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActiveBrandId = useCallback(
    (brandId: string) => {
      if (brandId === "all" && canViewAllBrands) {
        writeActiveBrandId(null);
        setActiveBrandState("all");
        const targetPath = permitsAllBrandScope(location.pathname)
          ? location.pathname
          : "/app/brands";
        const search = new URLSearchParams(
          targetPath === location.pathname ? location.search : "",
        );
        search.set("scope", "all");
        navigate(`${targetPath}?${search.toString()}`);
        return;
      }
      if (!brands.some((brand) => brand.id === brandId)) return;
      writeActiveBrandId(brandId);
      setActiveBrandState(brandId);
      if (
        permitsAllBrandScope(location.pathname) &&
        new URLSearchParams(location.search).get("scope") === "all"
      ) {
        const search = new URLSearchParams(location.search);
        search.delete("scope");
        const query = search.toString();
        navigate(`${location.pathname}${query ? `?${query}` : ""}`, {
          replace: true,
        });
      }
    },
    [brands, canViewAllBrands, location.pathname, location.search, navigate],
  );

  useEffect(() => {
    if (
      canViewAllBrands &&
      permitsAllBrandScope(location.pathname) &&
      new URLSearchParams(location.search).get("scope") === "all"
    ) {
      writeActiveBrandId(null);
      setActiveBrandState("all");
    }
  }, [canViewAllBrands, location.pathname, location.search]);

  useEffect(() => {
    if (
      activeBrandId !== "all" ||
      permitsAllBrandScope(location.pathname)
    ) {
      return;
    }
    const fallback =
      brands.find((brand) => brand.isDefault)?.id ?? brands[0]?.id ?? null;
    writeActiveBrandId(fallback);
    setActiveBrandState(fallback);
  }, [activeBrandId, brands, location.pathname]);

  const value = useMemo<BrandScopeValue>(
    () => ({
      status,
      error,
      brands,
      activeBrandId,
      activeBrand:
        brands.find((brand) => brand.id === activeBrandId) ?? null,
      setActiveBrandId,
      canViewAllBrands,
      refresh,
    }),
    [
      activeBrandId,
      brands,
      canViewAllBrands,
      error,
      refresh,
      setActiveBrandId,
      status,
    ],
  );

  return (
    <BrandScopeContext.Provider value={value}>
      {status === "loading" && brands.length === 0 ? (
        <LoadingScreen label="Loading your brand workspace" />
      ) : status === "error" ? (
        <main className="staff-content">
          <ErrorBlock error={error} onRetry={() => void refresh()} />
        </main>
      ) : (
        <Fragment key={activeBrandId ?? status}>{children}</Fragment>
      )}
    </BrandScopeContext.Provider>
  );
}

export function useBrandScope() {
  const context = useContext(BrandScopeContext);
  if (!context) {
    throw new Error("useBrandScope must be used within BrandScopeProvider");
  }
  return context;
}
