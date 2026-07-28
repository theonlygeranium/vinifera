const DEFAULT_LOCAL_PASSWORD = "ViniferaLocal1!";

export function resolveLocalPassword(value) {
  return value?.trim() ? value : DEFAULT_LOCAL_PASSWORD;
}

export const LOCAL_PASSWORD = resolveLocalPassword(
  process.env.VINIFERA_LOCAL_TEST_PASSWORD,
);

export function requiredEnvironment(name, aliases = []) {
  for (const candidate of [name, ...aliases]) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  throw new Error(`${[name, ...aliases].join(" or ")} is required.`);
}
