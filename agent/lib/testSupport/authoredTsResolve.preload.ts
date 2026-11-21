/**
 * Tests-only: register authored `.js` → `.ts` resolve remap after the official
 * network-deny preload. Enables importing agent/agent/agent.ts under Node
 * strip-types without a production import-specifier change.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "authoredTsResolve.loader.mjs")).href);
