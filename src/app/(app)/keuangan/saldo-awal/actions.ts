"use server";

import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountBalances } from "@/lib/ledger";
import { assertRole } from "@/lib/master-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { inventoryMethod, loadInventoryReport } from "@/lib/hpp-reports-server";
import {
  nilaiPersediaan, selisihSaldoAwal,
} from "@/lib/saldo-awal";

const BACK = "/keuangan/saldo-awal";

export type Usulan = {
  code: string; nama: string; sisi: "D" | "K";
  nyata: number; buku: number; selisih: number; sumber: string;
};

export type RingkasSaldoAwal = {
  usulan: Usulan[];
  sudahAda: { no_jurnal: string; tanggal: string } | null;
  akun: { code: string; name: string; type: string; normal: string }[];
};

async function bacaNilaiPersediaan(supabase: Awaited<ReturnType<typeof createClient>>) {
  if (await inventoryMethod(supabase) === "moving_average") {
    const report = await loadInventoryReport(supabase, {}, undefined, BACK);
    const value = report.summary.value;
    if (value === null || !Number.isFinite(value)) throw new Error("Nilai persediaan belum tersedia lengkap. Rekonsiliasi HPP sebelum mengusulkan saldo awal.");
    return { value, source: "Saldo stok × HPP rata-rata bergerak" };
  }
  const { data: layers, error } = await supabase.from("stock_layers").select("qty_left, unit_cost").gt("qty_left", 0);
  if (error) throw new Error(`Nilai persediaan gagal dibaca: ${error.message}`);
  return { value: nilaiPersediaan((layers ?? []) as { qty_left: number; unit_cost: number }[]), source: "Sisa lapisan stok × modalnya" };
}

/**
 * Hitung apa yang belum pernah masuk buku besar, dengan membandingkan kondisi NYATA
 * (stok fisik, daftar aset) terhadap saldo akunnya. Yang sudah benar akan berselisih 0
 * dan tidak muncul sebagai usulan.
 */
export async function bacaSaldoAwal(supabase: Awaited<ReturnType<typeof createClient>>): Promise<RingkasSaldoAwal> {
  const [balances, inventory, { data: assets }, { data: deps }, { data: entry }, { data: coa }] =
    await Promise.all([
      getAccountBalances(supabase as never),
      bacaNilaiPersediaan(supabase),
      supabase.from("fixed_assets").select("harga_perolehan").eq("is_active", true),
      supabase.from("asset_depreciations").select("amount"),
      supabase.from("journal_entries").select("no_jurnal, tanggal").eq("source", "saldo-awal").maybeSingle(),
      supabase.from("coa_accounts").select("code, name, type, normal_balance").eq("is_active", true).order("code"),
    ]);

  const saldo = (code: string) => balances.find((b) => b.code === code)?.saldo ?? 0;

  const persediaanNyata = inventory.value;
  const asetNyata = (assets ?? []).reduce((a, r) => a + Number(r.harga_perolehan), 0);
  const akumNyata = (deps ?? []).reduce((a, r) => a + Number(r.amount), 0);

  const usulan: Usulan[] = ([
    {
      code: "170001", nama: "Persediaan Obat & Produk", sisi: "D",
      nyata: persediaanNyata, buku: saldo("170001"),
      selisih: selisihSaldoAwal(persediaanNyata, saldo("170001")),
      sumber: inventory.source,
    },
    {
      code: "200008", nama: "Aset Tetap", sisi: "D",
      nyata: asetNyata, buku: saldo("200008"),
      selisih: selisihSaldoAwal(asetNyata, saldo("200008")),
      sumber: "Total harga perolehan aset aktif",
    },
    {
      // 200015 kontra-aset: saldo normalnya kredit, jadi 'nyata' dibandingkan apa adanya.
      code: "200015", nama: "Akumulasi Penyusutan", sisi: "K",
      nyata: akumNyata, buku: saldo("200015"),
      selisih: selisihSaldoAwal(akumNyata, saldo("200015")),
      sumber: "Total penyusutan yang sudah dijalankan",
    },
  ] as Usulan[]).filter((u) => u.selisih !== 0);

  return {
    usulan,
    sudahAda: entry ? { no_jurnal: entry.no_jurnal as string, tanggal: entry.tanggal as string } : null,
    akun: (coa ?? []).map((a) => ({
      code: a.code as string, name: a.name as string, type: a.type as string, normal: a.normal_balance as string,
    })),
  };
}

/** Initial entry only; monetary corrections have their own reviewed workflow. */
export async function simpanSaldoAwal(formData: FormData) {
  const supabase = await assertRole(BACK, "saldo awal", ["OWNER", "ADMIN", "FINANCE"]);
  const gagal = (message: string): never => redirect(`${BACK}?error=${encodeURIComponent(message)}`);
  const key = String(formData.get("draft_key") ?? "").trim();
  if (!key || key.length > 120) gagal("Identitas simpan belum tersedia. Muat ulang formulir.");
  let rows: unknown;
  try { rows = JSON.parse(String(formData.get("baris") ?? "[]")); }
  catch { gagal("Baris saldo awal tidak valid."); }
  if (!Array.isArray(rows) || !rows.length) gagal("Isi minimal satu baris saldo awal.");
  const { data, error } = await supabase.rpc("create_opening_balance_atomic", {
    p_request_key: key,
    p_tanggal: String(formData.get("tanggal") ?? "").trim() || hariIniWIB(),
    p_rows: rows,
  });
  if (error || !data?.entry_id) gagal(error?.message ?? "Saldo awal belum terkonfirmasi. Isian tetap tersedia.");
  revalidatePath("/", "layout");
  redirect(`${BACK}?success=${encodeURIComponent("Saldo awal tersimpan. Koreksi moneter tersedia melalui rekening kas/bank.")}${transactionDraftAck(formData)}`);
}

/** Kept to reject stale clients invoking the former destructive action. */
export async function hapusSaldoAwal() {
  redirect(`${BACK}?error=${encodeURIComponent("Riwayat saldo awal tidak boleh dihapus. Gunakan koreksi saldo awal pada rekening kas/bank.")}`);
}
