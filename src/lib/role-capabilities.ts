import { bolehDiskonManualBawaan } from "./akses-diskon";

export type RoleCapabilities = { all_branches: boolean; create_accounts: boolean; manual_discount: boolean };

/**
 * Nilai tersimpan menang per-kolom, bukan per-baris: kolom `manual_discount`
 * sengaja boleh null ("ikut bawaan") supaya peran yang sudah pernah disetel
 * sebelum kemampuan ini ada tidak diam-diam kehilangan haknya.
 */
export function roleCapabilities(role: string, saved?: Partial<RoleCapabilities> | null): RoleCapabilities {
  if (role === "OWNER") return { all_branches: true, create_accounts: true, manual_discount: true };
  const bawaan: RoleCapabilities = {
    all_branches: ["ADMIN", "FINANCE"].includes(role),
    create_accounts: role === "ADMIN",
    manual_discount: bolehDiskonManualBawaan(role),
  };
  if (!saved) return bawaan;
  return {
    all_branches: saved.all_branches ?? bawaan.all_branches,
    create_accounts: saved.create_accounts ?? bawaan.create_accounts,
    manual_discount: saved.manual_discount ?? bawaan.manual_discount,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadRoleCapabilities(client: any, role: string): Promise<RoleCapabilities> {
  if (role === "OWNER") return roleCapabilities(role);
  const { data, error } = await client.from("role_capabilities")
    .select("all_branches, create_accounts, manual_discount").eq("role", role).maybeSingle();
  if (error) return { all_branches: false, create_accounts: false, manual_discount: false };
  return roleCapabilities(role, data);
}
