import fs from "node:fs";
import { fileURLToPath } from "node:url";

const EXPECTED_SDK = "0.4.34";
const EXPECTED_BB = "0.41.0";

export function assertCompatibility(sourceSdk, metadata) {
  if (sourceSdk !== EXPECTED_SDK) {
    throw new Error(`expected published SDK ${EXPECTED_SDK}, found ${sourceSdk}`);
  }
  if (
    metadata.sdkVersion !== EXPECTED_SDK ||
    metadata.builtWith?.pluginSdkVersion !== EXPECTED_SDK
  ) {
    throw new Error(
      `expected exact SDK ${EXPECTED_SDK} build metadata, found ${metadata.sdkVersion ?? "unknown"}`,
    );
  }
  if (metadata.builtWith?.bbVersion !== EXPECTED_BB) {
    throw new Error(`expected BB ${EXPECTED_BB}, found ${metadata.builtWith?.bbVersion ?? "unknown"}`);
  }
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const packageJson = readJson(new URL("../package.json", import.meta.url));
  const serverMetadata = readJson(new URL("../dist/server.meta.json", import.meta.url));
  const hostMetadata = readJson(new URL("../dist/host.meta.json", import.meta.url));
  const sourceSdk = packageJson.devDependencies?.["@get-bb/plugin-sdk"];
  assertCompatibility(sourceSdk, serverMetadata);
  assertCompatibility(sourceSdk, hostMetadata);
  process.stdout.write(`SDK ${sourceSdk} declarations and BB ${EXPECTED_BB} build metadata match exactly\n`);
}
