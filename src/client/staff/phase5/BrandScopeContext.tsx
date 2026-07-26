import {
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

type BrandScopeStatus = "loading" | "ready" | "activation_required" | "error";

interface BrandScopeValue {
  status: BrandScopeStatus;
  brands: Brand[];
  activeBrandId: string | "all" | null;
  activeBrand: Brand | null;
  setActiveBrandId: (brandId: string) => void;
  canViewAllBrands: boolean;
  refresh: () => Promise<void>;
}

const BrandScopeContext = createContext<BrandScopeValue | null>(null);

export function BrandScopeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BrandScopeStatus>("loading");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [canViewAllBrands, setCanViewAllBrands] = useState(false);
  const [activeBrandId, setActiveBrandState] = useState<string | "all" | null>(
    readActiveBrandId,
  );
  const { location, navigate } = useRouter();

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await apiRequest<{
        items: Brand[];
        canViewAllBrands: boolean;
      }>("/api/brands");
      const nextBrands = response.items;
      const stored = readActiveBrandId();
      const next =
        nextBrands.find((brand) => brand.id === stored)?.id ??
        nextBrands.find((brand) => brand.isDefault)?.id ??
        nextBrands[0]?.id ??
        null;
      setBrands(nextBrands);
      setCanViewAllBrands(response.canViewAllBrands);
      setActiveBrandState(next);
      writeActiveBrandId(next);
      setStatus(nextBrands.length ? "ready" : "activation_required");
    } catch (error) {
      const activation =
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code?.toUpperCase() ===
          "ACTIVATION_REQUIRED";
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
        navigate("/app/brands?scope=all");
        return;
      }
      if (!brands.some((brand) => brand.id === brandId)) return;
      writeActiveBrandId(brandId);
      setActiveBrandState(brandId);
    },
    [brands, canViewAllBrands, navigate],
  );

  useEffect(() => {
    if (
      canViewAllBrands &&
      (location.pathname === "/app/brands" ||
        location.pathname === "/app/analytics") &&
      new URLSearchParams(location.search).get("scope") === "all"
    ) {
      writeActiveBrandId(null);
      setActiveBrandState("all");
    }
  }, [canViewAllBrands, location.pathname, location.search]);

  useEffect(() => {
    if (
      activeBrandId !== "all" ||
      location.pathname === "/app/brands" ||
      location.pathname === "/app/analytics"
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
      refresh,
      setActiveBrandId,
      status,
    ],
  );

  return (
    <BrandScopeContext.Provider value={value}>
      {children}
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
