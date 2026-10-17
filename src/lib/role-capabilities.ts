export type RoleCapabilities = { all_branches: boolean; create_accounts: boolean };

export function roleCapabilities(role: string, saved?: RoleCapabilities | null): RoleCapabilities {
  if (role === "OWNER") return { all_branches: true, create_accounts: true };
  return saved ?? {
    all_branches: ["ADMIN", "FINANCE"].includes(role),
    create_accounts: role === "ADMIN",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadRoleCapabilities(client: any, role: string): Promise<RoleCapabilities> {
  if (role === "OWNER") return roleCapabilities(role);
  const { data, error } = await client.from("role_capabilities")
    .select("all_branches, create_accounts").eq("role", role).maybeSingle();
  if (error) return { all_branches: false, create_accounts: false };
  return roleCapabilities(role, data);
}
