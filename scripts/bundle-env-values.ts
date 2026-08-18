export const SENTINEL_ENV_KEY = "MEDIAGO_TEST_SENTINEL_SECRET";
export const SENTINEL_VALUE = "mediago_bundle_secret_sentinel_6f2e7c9a";

export function buildVerificationEnvironment(
  input: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...input,
    MEDIAGO_PROFILE: "production",
  };
  delete environment[SENTINEL_ENV_KEY];
  delete environment.NODE_OPTIONS;
  return environment;
}

export function definesSentinelEnvironmentKey(
  contents: Buffer | string,
): boolean {
  return /^\s*(?:export\s+)?MEDIAGO_TEST_SENTINEL_SECRET\s*(?:=|:)/m.test(
    contents.toString(),
  );
}

export function buildInjectedEnvironmentBytes(original: Buffer): Buffer {
  const separator =
    original.length === 0 || original.at(-1) === 0x0a ? "" : "\n";
  return Buffer.concat([
    original,
    Buffer.from(`${separator}${SENTINEL_ENV_KEY}=${SENTINEL_VALUE}\n`, "utf8"),
  ]);
}
