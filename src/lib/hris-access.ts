export const PERAN_PENGELOLA_HRIS = ["OWNER", "ADMIN"] as const;

export function bolehKelolaHris(role: string): boolean {
  return PERAN_PENGELOLA_HRIS.includes(role as (typeof PERAN_PENGELOLA_HRIS)[number]);
}

export function bolehKelolaPayroll(role: string): boolean {
  return role === "OWNER";
}

export function bolehLihatDataPribadi(role: string): boolean {
  return role === "STAFF" || role === "DOCTOR";
}
