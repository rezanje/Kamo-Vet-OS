// Test fixture only. Builds the get_role_access_config() shape from the REAL frozen migrations
// (same catalogue rows, same `enforced=true` updates), so a "legacy role" here is exactly what
// the database returns for a role that has no saved action policy: actions.source="legacy",
// actions.allowed=[] while role_action_allowed() still returns true for every enforced action.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RoleAccessConfig, RoleAction } from "@/lib/role-access-catalog";

const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");

export function realActionCatalog(): RoleAction[] {
  const base = migration("20261106120000_role_settings_atomic.sql");
  const block = base.slice(base.indexOf("insert into role_settings_private.action_catalog"));
  const rows = [...block.slice(0, block.indexOf(";\n")).matchAll(/\('([^']+)','((?:[^']|'')*)','((?:[^']|'')*)',(true|false)\)/g)]
    .map(m => ({ id: m[1], label: m[2].replaceAll("''", "'"), group: m[3].replaceAll("''", "'"), enforced: m[4] === "true" }));
  const enforced = new Set<string>();
  for (const file of ["20261106130000_role_bank_actions.sql", "20261106140000_role_hris_user_actions.sql", "20261106150000_role_employee_actions.sql"]) {
    for (const stmt of migration(file).matchAll(/update role_settings_private\.action_catalog set enforced=true where id\s*(?:in\s*\(([^)]*)\)|=\s*('[^']+'))/g)) {
      for (const id of (stmt[1] ?? stmt[2]).matchAll(/'([^']+)'/g)) enforced.add(id[1]);
    }
  }
  return rows.map(r => ({ ...r, enforced: r.enforced || enforced.has(r.id) }));
}
export const enforcedIds = () => realActionCatalog().filter(a => a.enforced).map(a => a.id);

export const REVISION = "a".repeat(32);
/** A role with NO action_policies row (every role today): source "legacy", allowed []. */
export function legacySnapshot(role = "ADMIN", over: Partial<RoleAccessConfig> = {}): RoleAccessConfig {
  return { role, revision: REVISION, source: "defaults", modules: ["dashboard", "klinik"], capabilities: { all_branches: false, create_accounts: false }, audit: [],
    actions: { source: "legacy", allowed: [] }, action_catalog: realActionCatalog(), ...over };
}
/** A role with an explicit saved policy. */
export function customSnapshot(role: string, allowed: string[], over: Partial<RoleAccessConfig> = {}): RoleAccessConfig {
  return legacySnapshot(role, { source: "custom", actions: { source: "custom", allowed }, ...over });
}
