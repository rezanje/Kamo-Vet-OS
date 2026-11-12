import { MODULES } from "./nav";
import { SEMUA_PERAN } from "./akses";
import type { RoleCapabilities } from "./role-capabilities";
import { selectableSubmenus } from "./submenu-access";
import { legacyRoleHasAction } from "./role-grant-only-actions";

export const ROLE_ACCESS_CATALOG = [...MODULES.map(m => ({ ...m, group: "Modul" })),
  { id: "kasir", label: "Kasir", icon: "ti-cash-register", group: "Operasional" },
  { id: "quest-staff", label: "Quest Staff", icon: "ti-trophy", group: "Operasional" },
  { id: "pos-shift", label: "Shift Kasir", icon: "ti-clock", group: "Operasional" },
];
export const roleAccessScope = (role: string, revision: string) => `role-access:${role}:${revision}`;
export const validRevision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
export const validRequestKey = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const editableRole = (role: string) => role !== "OWNER" && (SEMUA_PERAN as readonly string[]).includes(role);
export type RoleAction = { id: string; label: string; group: string; enforced: boolean };
export type RoleAccessConfig = { actions: { source: "legacy" | "custom"; allowed: string[] }; action_catalog: RoleAction[]; role: string; revision: string; source: "defaults" | "legacy" | "custom"; modules: string[]; /** Kebijakan sub-menu: hanya modul yang dibatasi. Tidak ada/kosong = semua sub-menu (database lama tidak mengirimnya). */ submenus?: Record<string, string[]>; capabilities: RoleCapabilities; audit: { id: string; created_at: string; created_by: string; reason: string; before: unknown; after: unknown }[] };
export function parseRoleAccessConfig(value: unknown, role: string): RoleAccessConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as RoleAccessConfig;
  if (!v.actions || Array.isArray(v.actions) || !["legacy", "custom"].includes(v.actions.source)
    || !Array.isArray(v.action_catalog) || !v.action_catalog.every(a => a && typeof a === "object" && !Array.isArray(a)
      && typeof a.id === "string" && /^[a-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(a.id)
      && typeof a.label === "string" && a.label.trim().length > 0 && typeof a.group === "string" && a.group.trim().length > 0 && typeof a.enforced === "boolean")
    || new Set(v.action_catalog.map(a => a.id)).size !== v.action_catalog.length
    || !Array.isArray(v.actions.allowed) || new Set(v.actions.allowed).size !== v.actions.allowed.length
    || !v.actions.allowed.every(id => typeof id === "string" && v.action_catalog.some(a => a.id === id && a.enforced))) return null;
  if (v.submenus !== undefined && (!v.submenus || typeof v.submenus !== "object" || Array.isArray(v.submenus)
    || !Object.entries(v.submenus).every(([m, list]) => selectableSubmenus(m).length > 0 && Array.isArray(list) && list.every(id => typeof id === "string")))) return null;
  if (v.role !== role || !validRevision(v.revision) || !["defaults", "legacy", "custom"].includes(v.source)
    || !Array.isArray(v.modules) || new Set(v.modules).size !== v.modules.length
    || !v.modules.every(id => ROLE_ACCESS_CATALOG.some(m => m.id === id))
    || !v.capabilities || typeof v.capabilities.all_branches !== "boolean" || typeof v.capabilities.create_accounts !== "boolean"
    || !Array.isArray(v.audit) || !v.audit.every(a => a && typeof a.id === "string" && typeof a.reason === "string" && typeof a.created_at === "string" && typeof a.created_by === "string" && "before" in a && "after" in a)) return null;
  return v;
}
/** The policy the database actually applies: no saved action policy ("legacy") allows every enforced action
 * (subject to the original role/branch/state ceilings); an explicit policy allows exactly its list.
 * Exception: grant-only actions (izin khusus, e.g. pembelian.batalkan_*) are OFF for a legacy role: the database only allows them when a saved
 * policy lists them explicitly — kecuali pengecualian per peran (GRANT_ONLY_LEGACY_ROLES, mis. diskon manual: ADMIN legacy boleh). */
export const effectiveAllowedActions = (config: RoleAccessConfig): string[] =>
  config.actions.source === "legacy" ? config.action_catalog.filter(a => a.enforced && legacyRoleHasAction(a.id, config.role)).map(a => a.id) : config.actions.allowed;
