export type UserAccountEditSnapshot = {
  profile_id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  branch_ids: string[];
  version: string;
  editable_roles: string[];
  self: boolean;
};

export type UserAccountEditBranch = { id: string; name: string; is_active: boolean; code?: string; type?: string; legacy?: boolean };

export function isAccountEditId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isUserAccountEditSnapshot(value: unknown, id: string): value is UserAccountEditSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<UserAccountEditSnapshot>;
  const roles = ["OWNER", "ADMIN", "FINANCE", "DOCTOR", "STAFF"];
  return row.profile_id === id && (typeof row.full_name === "string" || row.full_name === null)
    && typeof row.role === "string" && roles.includes(row.role)
    && typeof row.is_active === "boolean" && typeof row.self === "boolean"
    && typeof row.version === "string" && !!row.version
    && Array.isArray(row.branch_ids) && row.branch_ids.every((branch) => typeof branch === "string" && isAccountEditId(branch))
    && Array.isArray(row.editable_roles) && row.editable_roles.every((role) => roles.includes(role));
}
