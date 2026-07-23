// Mesin penyusutan garis lurus — dipakai action manual, lazy catch-up (halaman Aset),
// dan cron bulanan (/api/cron/depreciation). Idempotent: unique(asset_id, periode).

import { depreciationPerMonth, monthsElapsed } from "@/lib/aging";
import { postJournal } from "@/lib/posting";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type DepreciationRun = { periode: string; total: number; jumlahAset: number };

// Jalankan penyusutan untuk satu periode YYYY-MM. Aman diulang (aset yang sudah
// disusutkan periode itu ditolak unique constraint → skip).
export async function runDepreciationPeriod(supabase: AnyClient, periode: string): Promise<DepreciationRun> {
  const { data: assets } = await supabase
    .from("fixed_assets")
    .select("id, nama, tanggal_perolehan, harga_perolehan, nilai_sisa, umur_bulan")
    .eq("is_active", true);

  const { data: deps } = await supabase.from("asset_depreciations").select("asset_id, amount");
  const depSum = new Map<string, number>();
  for (const d of deps ?? []) depSum.set(d.asset_id, (depSum.get(d.asset_id) ?? 0) + Number(d.amount));

  let total = 0;
  let jumlahAset = 0;
  for (const a of assets ?? []) {
    const bulan = monthsElapsed(a.tanggal_perolehan, periode);
    if (bulan < 1 || bulan > a.umur_bulan) continue; // belum mulai / habis umur

    const perBulan = depreciationPerMonth(Number(a.harga_perolehan), Number(a.nilai_sisa), a.umur_bulan);
    const sisaDisusutkan = Math.max(0, Number(a.harga_perolehan) - Number(a.nilai_sisa) - (depSum.get(a.id) ?? 0));
    const amount = Math.min(perBulan, sisaDisusutkan);
    if (amount <= 0) continue;

    const { error } = await supabase.from("asset_depreciations").insert({ asset_id: a.id, periode, amount });
    if (error) continue; // sudah pernah jalan utk periode ini → skip
    total += amount;
    jumlahAset += 1;
  }

  if (total > 0) {
    await postJournal(supabase, {
      tanggal: `${periode}-28`,
      deskripsi: `Penyusutan aset tetap periode ${periode} (${jumlahAset} aset)`,
      source: "depreciation",
      sourceRef: periode,
      branchId: null,
      lines: [
        { code: "5601", debit: total, credit: 0 },
        { code: "1509", debit: 0, credit: total },
      ],
    });
  }
  return { periode, total, jumlahAset };
}

const MAX_CATCHUP_MONTHS = 36; // ponytail: batas mundur; naikkan kalau ada aset lebih tua

// Catch-up: susutkan semua periode dari bulan perolehan aset tertua s/d bulan berjalan.
// Dipanggil lazy dari halaman Aset + cron — dua-duanya aman karena idempotent.
export async function catchUpDepreciation(supabase: AnyClient): Promise<DepreciationRun[]> {
  const { data: oldest } = await supabase
    .from("fixed_assets")
    .select("tanggal_perolehan")
    .eq("is_active", true)
    .order("tanggal_perolehan", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!oldest) return [];

  const now = new Date();
  const start = new Date(oldest.tanggal_perolehan + "T00:00:00");
  const results: DepreciationRun[] = [];
  const cursor = new Date(Math.max(
    start.getTime(),
    new Date(now.getFullYear(), now.getMonth() - (MAX_CATCHUP_MONTHS - 1), 1).getTime(),
  ));
  cursor.setDate(1);

  while (cursor.getFullYear() < now.getFullYear() ||
         (cursor.getFullYear() === now.getFullYear() && cursor.getMonth() <= now.getMonth())) {
    const periode = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const run = await runDepreciationPeriod(supabase, periode);
    if (run.total > 0) results.push(run);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return results;
}
