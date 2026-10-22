import { fileURLToPath } from "node:url";
import { CLI_FILE_NAME, ENVIRONMENT } from "../modules/skill-identity.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shared workflow modules live beside dashboard in the same skill.
  turbopack: { root: fileURLToPath(new URL("../", import.meta.url)) },
  // Spawn the installed CLI, not a bundled copy whose relative modules are absent.
  env: { [ENVIRONMENT.CLI_PATH]: fileURLToPath(new URL(`../scripts/${CLI_FILE_NAME}`, import.meta.url)) },
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
