import { createClient } from "@supabase/supabase-js";
import {
  LOCAL_PASSWORD,
  requiredEnvironment,
} from "./local-dev-config.mjs";
import { assertLoopbackHttpOrigin } from "./local-dev-url.mjs";

const organizations = {
  pacific: "10000000-0000-4000-8000-000000000002",
  sunrise: "10000000-0000-4000-8000-000000000001",
};

const accounts = [
  {
    email: "owner.sunrise@example.com",
    fullName: "Sunrise Local Owner",
    kind: "staff",
    organizationId: organizations.sunrise,
  },
  {
    email: "owner.pacific@example.com",
    fullName: "Pacific Local Owner",
    kind: "staff",
    organizationId: organizations.pacific,
  },
  {
    email: "member.sunrise@example.com",
    fullName: "Avery Adams",
    kind: "member",
    organizationId: organizations.sunrise,
    memberId: "40000000-0000-4000-8000-000000000001",
  },
  {
    email: "member.pacific@example.com",
    fullName: "Jordan Jones",
    kind: "member",
    organizationId: organizations.pacific,
    memberId: "40000000-0000-4000-8000-000000000010",
  },
];

const supabaseUrl = assertLoopbackHttpOrigin(
  requiredEnvironment("SUPABASE_URL"),
  "SUPABASE_URL",
);
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY", [
  "SUPABASE_SECRET_KEY",
]);
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function findUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;
    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    if (user) return user;
    if (data.users.length < 100) return null;
  }
  throw new Error("Local Auth user scan exceeded 2,000 users.");
}

async function ensureUser(account) {
  const metadata = {
    auth_surface: account.kind,
    full_name: account.fullName,
    local_fixture: true,
  };
  const existing = await findUser(account.email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(
      existing.id,
      {
        email: account.email,
        email_confirm: true,
        password: LOCAL_PASSWORD,
        user_metadata: metadata,
      },
    );
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    email_confirm: true,
    password: LOCAL_PASSWORD,
    user_metadata: metadata,
  });
  if (error) throw error;
  return data.user;
}

const { data: organizationRows, error: organizationError } = await supabase
  .from("organizations")
  .select("id,default_brand_id")
  .in("id", Object.values(organizations));
if (organizationError) throw organizationError;
const brandByOrganization = new Map(
  (organizationRows ?? []).map((organization) => [
    organization.id,
    organization.default_brand_id,
  ]),
);

for (const account of accounts) {
  const brandId = brandByOrganization.get(account.organizationId);
  if (!brandId) {
    throw new Error(`Default brand missing for ${account.organizationId}.`);
  }
  const user = await ensureUser(account);
  if (!user) {
    throw new Error(`Supabase did not return ${account.email}.`);
  }

  if (account.kind === "staff") {
    const { error: staffError } = await supabase.from("staff_users").upsert(
      {
        email: account.email,
        id: user.id,
        organization_id: account.organizationId,
        role: "owner",
        status: "active",
      },
      { onConflict: "id" },
    );
    if (staffError) throw staffError;

    const { error: organizationAccessError } = await supabase
      .from("organization_staff_access")
      .upsert(
        {
          organization_id: account.organizationId,
          scope: "all_brands",
          staff_user_id: user.id,
        },
        { onConflict: "organization_id,staff_user_id" },
      );
    if (organizationAccessError) throw organizationAccessError;

    const { error: brandAccessError } = await supabase
      .from("staff_brand_access")
      .upsert(
        {
          access_level: "admin",
          brand_id: brandId,
          organization_id: account.organizationId,
          staff_user_id: user.id,
        },
        { onConflict: "organization_id,staff_user_id,brand_id" },
      );
    if (brandAccessError) throw brandAccessError;
  } else {
    const { data, error } = await supabase
      .from("members")
      .update({ auth_user_id: user.id })
      .eq("id", account.memberId)
      .eq("organization_id", account.organizationId)
      .eq("brand_id", brandId)
      .select("id")
      .single();
    if (error) throw error;
    if (data.id !== account.memberId) {
      throw new Error(`Member link failed for ${account.email}.`);
    }
  }
}

console.log(`PASS bootstrapped ${accounts.length} loopback-only Auth users`);
