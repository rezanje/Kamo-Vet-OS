// Gaji pokok tinggal di `employee_base_salaries` (migrasi 20261027030000), bukan di
// `employees` yang dibaca semua akun. RLS hanya mengembalikan baris untuk OWNER/FINANCE;
// peran lain menerima peta kosong, jadi layar menampilkan "—" tanpa bocor angka.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export async function bacaGajiPokok(supabase: AnyClient, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("employee_base_salaries").select("employee_id, gaji_pokok").in("employee_id", ids.slice(i, i + 200));
    if (error) throw new Error("Gaji pokok belum dapat dibaca");
    for (const r of (data ?? []) as { employee_id: string; gaji_pokok: number }[]) map.set(r.employee_id, Number(r.gaji_pokok));
  }
  return map;
}

export async function simpanGajiPokok(supabase: AnyClient, employeeId: string, gajiPokok: number): Promise<boolean> {
  const { error } = await supabase.from("employee_base_salaries")
    .upsert({ employee_id: employeeId, gaji_pokok: gajiPokok, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
  return !error;
}
