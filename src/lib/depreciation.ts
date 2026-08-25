// Mesin penyusutan garis lurus — dipakai action manual, lazy catch-up (halaman Aset),
// dan cron bulanan (/api/cron/akhir-bulan). Idempotent: unique(asset_id, periode).

// Impor relatif (bukan alias @/) supaya modul ini bisa diuji langsung oleh Vitest,
// yang tidak memuat alias tsconfig. Sama pola dgn barang.ts → ./tindakan.
import { depreciationPerMonth, monthsElapsed } from "./aging";
import { postJournal } from "./posting";
import { hariIniWIB } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type DepreciationRun = { periode: string; total: number; jumlahAset: number };

export const AKUN_BEBAN_DEFAULT = "5601";
export const AKUN_AKUM_DEFAULT = "1509";

export type DepEntry = { amount: number; akunBeban: string | null; akunAkumulasi: string | null };

// Penyusutan sebulan penuh baru boleh diakui setelah bulannya BENAR-BENAR lewat.
// Sebelum perbaikan ini, menjalankan catch-up tanggal 10 langsung memposting jurnal
// bertanggal 28 bulan yang sama — beban masa depan masuk ke Laba Rugi hari ini.
export function periodeBelumSelesai(periode: string, hariIni: string): boolean {
  return periode >= hariIni.slice(0, 7);
}

// Tanggal jurnal penyusutan: akhir periode (pakai 28 supaya aman untuk Februari).
export const tanggalJurnalPenyusutan = (periode: string) => `${periode}-28`;

// Baris jurnal penyusutan dikelompokkan per pasangan akun kategori. Satu jurnal,
// beberapa pasang baris — jadi laporan penyusutan rinci per jenis aset tanpa
// mengubah total. Aset tanpa kategori memakai akun default lama.
export function groupDepreciationLines(entries: DepEntry[]): { code: string; debit: number; credit: number }[] {
  const perPasangan = new Map<string, { beban: string; akum: string; total: number }>();
  for (const e of entries) {
    const amount = Number(e.amount) || 0;
    if (amount <= 0) continue;
    const beban = e.akunBeban || AKUN_BEBAN_DEFAULT;
    const akum = e.akunAkumulasi || AKUN_AKUM_DEFAULT;
    const key = `${beban}::${akum}`;
    const cur = perPasangan.get(key) ?? { beban, akum, total: 0 };
    cur.total += amount;
    perPasangan.set(key, cur);
  }

  const out: { code: string; debit: number; credit: number }[] = [];
  for (const { beban, akum, total } of perPasangan.values()) {
    out.push({ code: beban, debit: total, credit: 0 });
    out.push({ code: akum, debit: 0, credit: total });
  }
  return out;
}

// Jalankan penyusutan untuk satu periode YYYY-MM. Aman diulang (aset yang sudah
// disusutkan periode itu ditolak unique constraint → skip).
export async function runDepreciationPeriod(supabase: AnyClient, periode: string, hariIni?: string): Promise<DepreciationRun> {
  // Satu-satunya penjaga untuk cron, catch-up, dan tombol manual sekaligus.
  if (periodeBelumSelesai(periode, hariIni ?? hariIniWIB())) {
    return { periode, total: 0, jumlahAset: 0 };
  }

  const { data: assets } = await supabase
    .from("fixed_assets")
    .select("id, nama, tanggal_perolehan, harga_perolehan, nilai_sisa, umur_bulan, asset_categories(akun_beban, akun_akumulasi)")
    .eq("is_active", true);

  const { data: deps } = await supabase.from("asset_depreciations").select("asset_id, amount");
  const depSum = new Map<string, number>();
  for (const d of deps ?? []) depSum.set(d.asset_id, (depSum.get(d.asset_id) ?? 0) + Number(d.amount));

  let total = 0;
  let jumlahAset = 0;
  const entries: DepEntry[] = [];
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

    const rel = a.asset_categories as
      | { akun_beban: string; akun_akumulasi: string }
      | { akun_beban: string; akun_akumulasi: string }[]
      | null;
    const kat = Array.isArray(rel) ? rel[0] : rel;
    entries.push({ amount, akunBeban: kat?.akun_beban ?? null, akunAkumulasi: kat?.akun_akumulasi ?? null });
  }

  if (total > 0) {
    await postJournal(supabase, {
      tanggal: tanggalJurnalPenyusutan(periode),
      deskripsi: `Penyusutan aset tetap periode ${periode} (${jumlahAset} aset)`,
      source: "depreciation",
      sourceRef: periode,
      branchId: null,
      lines: groupDepreciationLines(entries),
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

  // Bulan berjalan ditentukan menurut WIB, bukan zona server (Vercel = UTC).
  const hariIni = hariIniWIB();
  const now = new Date(`${hariIni}T00:00:00`);
  const start = new Date(oldest.tanggal_perolehan + "T00:00:00");
  const results: DepreciationRun[] = [];
  const cursor = new Date(Math.max(
    start.getTime(),
    new Date(now.getFullYear(), now.getMonth() - (MAX_CATCHUP_MONTHS - 1), 1).getTime(),
  ));
  cursor.setDate(1);

  // Berhenti di bulan LALU: bulan berjalan belum selesai, jadi belum boleh disusutkan.
  while (cursor.getFullYear() < now.getFullYear() ||
         (cursor.getFullYear() === now.getFullYear() && cursor.getMonth() < now.getMonth())) {
    const periode = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const run = await runDepreciationPeriod(supabase, periode, hariIni);
    if (run.total > 0) results.push(run);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return results;
}
