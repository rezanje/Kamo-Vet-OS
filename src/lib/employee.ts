// Karyawan yang tertaut ke akun login (untuk dashboard pribadi /me).
type AnyClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type MyEmployee = { id: string; nama: string; jabatan: string | null; branch_id: string | null };

export async function getMyEmployee(supabase: AnyClient, userId: string): Promise<MyEmployee | null> {
  const { data } = await supabase
    .from("employees")
    .select("id, nama, jabatan, branch_id")
    .eq("profile_id", userId)
    .maybeSingle();
  return data ?? null;
}
