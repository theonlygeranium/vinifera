import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireConfigured } from "./errors";
import type { WorkerEnv } from "../types";

export function createSupabaseAdminClient(env: WorkerEnv): SupabaseClient {
  const url = requireConfigured(env.SUPABASE_URL, "SUPABASE_URL");
  const secret = requireConfigured(
    env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SECRET_KEY",
  );
  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
