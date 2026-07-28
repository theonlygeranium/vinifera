export function assertLoopbackHttpOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a loopback HTTP origin.`);
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    url.protocol !== "http:" ||
    !localHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be a loopback HTTP origin.`);
  }
  return url.origin;
}
