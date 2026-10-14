// Karyawan yang tertaut ke akun login (untuk dashboard pribadi /me).
type AnyClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type MyEmployee = { id: string; nik: string | null; nama: string; jabatan: string | null; branch_id: string | null };

export async function getMyEmployee(supabase: AnyClient, userId: string): Promise<MyEmployee | null> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, nik, nama, jabatan, branch_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) throw new Error("Tautan karyawan HRIS gagal dimuat. Hubungi admin bila tautan ganda.");
  return data ?? null;
}
