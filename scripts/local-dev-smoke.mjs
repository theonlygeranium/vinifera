import { createClient } from "@supabase/supabase-js";
import {
  LOCAL_PASSWORD,
  requiredEnvironment,
} from "./local-dev-config.mjs";
import { assertLoopbackHttpOrigin } from "./local-dev-url.mjs";

const SUNRISE_MEMBER_IDS = new Set(
  Array.from(
    { length: 9 },
    (_, index) =>
      `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ),
);

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, workerOrigin), {
    ...init,
    headers: {
      origin: workerOrigin,
      ...init.headers,
    },
  });
  const body = await responseBody(response);
  return { body, response };
}

function expectStatus(result, expected, label) {
  if (result.response.status !== expected) {
    throw new Error(
      `${label}: expected HTTP ${expected}, received ${result.response.status}: ${JSON.stringify(result.body)}`,
    );
  }
}

function cookieHeader(response) {
  const setCookies = setCookieHeaders(response);
  if (setCookies.length === 0) {
    throw new Error("Staff login did not set a session cookie.");
  }
  return setCookies
    .map((cookie) => {
      const delimiter = cookie.indexOf(";");
      return delimiter === -1 ? cookie : cookie.slice(0, delimiter);
    })
    .join("; ");
}

function setCookieHeaders(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
}

function mergeCookieJar(jar, response) {
  for (const setCookie of setCookieHeaders(response)) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieJarHeader(jar) {
  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function mailpitMessages() {
  const response = await fetch(new URL("/api/v1/messages", mailpitOrigin));
  if (!response.ok) {
    throw new Error(`Mailpit message list returned HTTP ${response.status}.`);
  }
  const body = await response.json();
  return Array.isArray(body.messages) ? body.messages : [];
}

async function waitForMagicLink(existingMessageIds) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const messages = await mailpitMessages();
    const message = messages.find(
      (candidate) =>
        !existingMessageIds.has(candidate.ID) &&
        candidate.Subject === "Your sign-in link" &&
        candidate.To?.some(
          (recipient) =>
            recipient.Address?.toLowerCase() ===
            "member.sunrise@example.com",
        ),
    );
    if (message) {
      const response = await fetch(
        new URL(`/api/v1/message/${encodeURIComponent(message.ID)}`, mailpitOrigin),
      );
      if (!response.ok) {
        throw new Error(`Mailpit message detail returned HTTP ${response.status}.`);
      }
      const detail = await response.json();
      const bodies = [detail.HTML, detail.Text].filter(
        (body) => typeof body === "string",
      );
      for (const body of bodies) {
        for (const match of body.matchAll(/https?:\/\/[^\s"'<>]+/gu)) {
          const candidate = match[0].replaceAll("&amp;", "&");
          const url = new URL(candidate);
          if (
            url.origin === supabaseUrl &&
            url.pathname === "/auth/v1/verify" &&
            url.searchParams.get("type") === "magiclink"
          ) {
            return url;
          }
        }
      }
      throw new Error("The local magic-link email did not contain a verify URL.");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Mailpit did not receive a new member magic-link email.");
}

async function staffLogin(email) {
  const result = await request("/api/auth/staff/login", {
    body: JSON.stringify({ email, password: LOCAL_PASSWORD }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expectStatus(result, 200, `${email} staff login`);
  return cookieHeader(result.response);
}

const workerOrigin = assertLoopbackHttpOrigin(
  process.env.VINIFERA_LOCAL_WORKER_URL ?? "http://127.0.0.1:8788",
  "VINIFERA_LOCAL_WORKER_URL",
);
const supabaseUrl = assertLoopbackHttpOrigin(
  requiredEnvironment("SUPABASE_URL"),
  "SUPABASE_URL",
);
const mailpitOrigin = assertLoopbackHttpOrigin(
  process.env.SUPABASE_MAILPIT_URL ?? "http://127.0.0.1:54324",
  "SUPABASE_MAILPIT_URL",
);
const publicKey = requiredEnvironment("SUPABASE_ANON_KEY", [
  "SUPABASE_PUBLISHABLE_KEY",
]);
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY", [
  "SUPABASE_SECRET_KEY",
]);
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const { data: sunriseOrganization, error: sunriseOrganizationError } =
  await adminClient
    .from("organizations")
    .select("default_brand_id")
    .eq("id", "10000000-0000-4000-8000-000000000001")
    .single();
if (sunriseOrganizationError || !sunriseOrganization.default_brand_id) {
  throw new Error("Sunrise default brand could not be resolved.");
}
const sunriseBrand = sunriseOrganization.default_brand_id;

const health = await request("/api/health");
expectStatus(health, 200, "health");
if (health.body?.data?.status !== "ok") {
  throw new Error(`Health response is not healthy: ${JSON.stringify(health.body)}`);
}
console.log("PASS Worker health");

const unauthorized = await request("/api/members");
expectStatus(unauthorized, 401, "unauthenticated member-list protection");
console.log("PASS member list rejects unauthenticated requests");

const sunriseCookie = await staffLogin("owner.sunrise@example.com");
const sunriseMembers = await request("/api/members?limit=100", {
  headers: {
    cookie: sunriseCookie,
    "x-vinifera-brand-id": sunriseBrand,
  },
});
expectStatus(sunriseMembers, 200, "Sunrise member list");
if (sunriseMembers.body?.data?.total !== 9) {
  throw new Error(
    `Sunrise member list expected 9 members: ${JSON.stringify(sunriseMembers.body)}`,
  );
}
const memberIds = sunriseMembers.body.data.items.map((member) => member.id);
if (
  memberIds.length !== SUNRISE_MEMBER_IDS.size ||
  memberIds.some((id) => !SUNRISE_MEMBER_IDS.has(id))
) {
  throw new Error("Sunrise member list contained a cross-tenant fixture.");
}
console.log("PASS Sunrise staff login and scoped member list");

const pacificCookie = await staffLogin("owner.pacific@example.com");
const crossTenant = await request("/api/members", {
  headers: {
    cookie: pacificCookie,
    "x-vinifera-brand-id": sunriseBrand,
  },
});
expectStatus(crossTenant, 403, "cross-tenant brand request");
console.log("PASS cross-tenant staff request is forbidden");

const memberClient = createClient(supabaseUrl, publicKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const { data: memberAuth, error: memberAuthError } =
  await memberClient.auth.signInWithPassword({
    email: "member.sunrise@example.com",
    password: LOCAL_PASSWORD,
  });
if (memberAuthError || !memberAuth.session?.access_token) {
  throw new Error(
    `Local member Auth failed: ${memberAuthError?.message ?? "no access token"}`,
  );
}
const memberSession = await request("/api/auth/member/session", {
  headers: {
    authorization: `Bearer ${memberAuth.session.access_token}`,
  },
});
expectStatus(memberSession, 200, "member bearer session");
if (
  memberSession.body?.data?.authenticated !== true ||
  memberSession.body?.data?.user?.id !==
    "40000000-0000-4000-8000-000000000001" ||
  memberSession.body?.data?.brand?.id !== sunriseBrand
) {
  throw new Error(
    `Member session did not resolve the seeded tenant: ${JSON.stringify(memberSession.body)}`,
  );
}
console.log("PASS member Auth token resolves to seeded membership");

const existingMailIds = new Set(
  (await mailpitMessages()).map((message) => message.ID),
);
const magicLink = await request("/api/auth/member/magic-link", {
  body: JSON.stringify({
    brandId: sunriseBrand,
    email: "member.sunrise@example.com",
  }),
  headers: { "content-type": "application/json" },
  method: "POST",
});
expectStatus(magicLink, 200, "member magic-link request");
const memberCookieJar = new Map();
mergeCookieJar(memberCookieJar, magicLink.response);
const verifyUrl = await waitForMagicLink(existingMailIds);
const verifyResponse = await fetch(verifyUrl, { redirect: "manual" });
if (![302, 303].includes(verifyResponse.status)) {
  throw new Error(
    `Supabase magic-link verification expected a redirect, received HTTP ${verifyResponse.status}.`,
  );
}
const callbackLocation = verifyResponse.headers.get("location");
if (!callbackLocation) {
  throw new Error("Supabase magic-link verification omitted its callback location.");
}
const callbackUrl = new URL(callbackLocation, verifyUrl);
if (
  callbackUrl.origin !== workerOrigin ||
  callbackUrl.pathname !== "/api/auth/member/callback"
) {
  throw new Error("Supabase magic-link verification left the local callback boundary.");
}
const callbackResponse = await fetch(callbackUrl, {
  headers: { cookie: cookieJarHeader(memberCookieJar) },
  redirect: "manual",
});
if (callbackResponse.status !== 303) {
  throw new Error(
    `Member magic-link callback expected HTTP 303, received ${callbackResponse.status}.`,
  );
}
const callbackCookies = setCookieHeaders(callbackResponse);
if (
  !callbackCookies.some(
    (cookie) =>
      cookie.startsWith("vinifera-member-auth") &&
      cookie.toLowerCase().includes("httponly"),
  )
) {
  throw new Error("Member callback did not issue an HTTP-only member session cookie.");
}
mergeCookieJar(memberCookieJar, callbackResponse);
const callbackDestination = new URL(
  callbackResponse.headers.get("location") ?? "",
  callbackUrl,
);
if (
  callbackDestination.origin !== workerOrigin ||
  !["/portal", "/portal/"].includes(callbackDestination.pathname)
) {
  throw new Error("Member callback did not redirect to the local member portal.");
}
const memberCookie = cookieJarHeader(memberCookieJar);
const cookieSession = await request("/api/auth/member/session", {
  headers: { cookie: memberCookie },
});
expectStatus(cookieSession, 200, "member cookie session");
if (
  cookieSession.body?.data?.authenticated !== true ||
  cookieSession.body?.data?.user?.id !==
    "40000000-0000-4000-8000-000000000001" ||
  cookieSession.body?.data?.brand?.id !== sunriseBrand
) {
  throw new Error(
    `Member cookie did not resolve the seeded tenant: ${JSON.stringify(cookieSession.body)}`,
  );
}
const memberShipments = await request("/api/member/shipments", {
  headers: { cookie: memberCookie },
});
expectStatus(memberShipments, 200, "member portal shipments");
if (
  !Array.isArray(memberShipments.body?.data) ||
  memberShipments.body.data.length < 1
) {
  throw new Error("Member portal did not return seeded shipment data.");
}
const memberPortal = await request("/portal/", {
  headers: { cookie: memberCookie },
});
expectStatus(memberPortal, 200, "member portal shell");
console.log(
  "PASS member magic-link callback issues an HTTP-only cookie and populated portal",
);

const appShell = await request("/app/");
expectStatus(appShell, 200, "application shell");
if (
  typeof appShell.body !== "string" ||
  !appShell.body.toLowerCase().includes("<!doctype html")
) {
  throw new Error("The Worker did not serve the application shell.");
}
console.log("PASS Worker serves the built application shell");
