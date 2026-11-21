/**
 * Tests-only Node custom loader: remap local authored `.js` import specifiers
 * to sibling `.ts` sources when the `.js` file is absent.
 *
 * Why: agent/agent/agent.ts uses TypeScript ESM `.js` specifiers
 * (`../lib/liveSelection.js`). Eve's bundler resolves those; Node's strip-types
 * path does not. This loader exists so offline tests can import the production
 * agent module without changing production selection semantics.
 *
 * Not a production runtime dependency.
 */
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context).catch(async (err) => {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    if (!specifier.endsWith(".js")) throw err;
    if (!context.parentURL) throw err;

    const parentPath = fileURLToPath(context.parentURL);
    // Only remap relative authored imports (not node_modules bare specifiers).
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) throw err;

    const parentDir = dirname(parentPath);
    const absJs = join(parentDir, specifier);
    const absTs = absJs.replace(/\.js$/u, ".ts");
    if (existsSync(absJs) || !existsSync(absTs)) throw err;

    return nextResolve(pathToFileURL(absTs).href, context);
  });
  return result;
}
