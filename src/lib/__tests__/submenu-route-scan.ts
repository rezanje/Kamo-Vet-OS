import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every file Next treats as a page or route handler (ts/tsx/js/jsx), so a new page cannot hide behind its extension. */
export const ROUTE_FILE = /^(page|route)\.(tsx?|jsx?)$/;

export function findRouteFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== "__tests__") walk(full); continue; }
      if (ROUTE_FILE.test(name)) found.push(full);
    }
  };
  walk(root);
  return found;
}
