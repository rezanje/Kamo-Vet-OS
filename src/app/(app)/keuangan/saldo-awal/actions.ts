"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountBalances } from "@/lib/ledger";
import { nextSeqJurnal, prefixJurnal } from "@/lib/posting";
import { formatNomor } from "@/lib/no-dokumen";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";
import {
  AKUN_MODAL_PEMILIK, jurnalSaldoAwal, nilaiPersediaan, selisihSaldoAwal,
  type BarisSaldoAwal,
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

/**
 * Hitung apa yang belum pernah masuk buku besar, dengan membandingkan kondisi NYATA
 * (stok fisik, daftar aset) terhadap saldo akunnya. Yang sudah benar akan berselisih 0
 * dan tidak muncul sebagai usulan.
 */
export async function bacaSaldoAwal(supabase: Awaited<ReturnType<typeof createClient>>): Promise<RingkasSaldoAwal> {
  const [balances, { data: layers }, { data: assets }, { data: deps }, { data: entry }, { data: coa }] =
    await Promise.all([
      getAccountBalances(supabase as never),
      supabase.from("stock_layers").select("qty_left, unit_cost").gt("qty_left", 0),
      supabase.from("fixed_assets").select("harga_perolehan").eq("is_active", true),
      supabase.from("asset_depreciations").select("amount"),
      supabase.from("journal_entries").select("no_jurnal, tanggal").eq("source", "saldo-awal").maybeSingle(),
      supabase.from("coa_accounts").select("code, name, type, normal_balance").eq("is_active", true).order("code"),
    ]);

  const saldo = (code: string) => balances.find((b) => b.code === code)?.saldo ?? 0;

  const persediaanNyata = nilaiPersediaan((layers ?? []) as { qty_left: number; unit_cost: number }[]);
  const asetNyata = (assets ?? []).reduce((a, r) => a + Number(r.harga_perolehan), 0);
  const akumNyata = (deps ?? []).reduce((a, r) => a + Number(r.amount), 0);

  const usulan: Usulan[] = ([
    {
      code: "1301", nama: "Persediaan Obat & Produk", sisi: "D",
      nyata: persediaanNyata, buku: saldo("1301"),
      selisih: selisihSaldoAwal(persediaanNyata, saldo("1301")),
      sumber: "Sisa lapisan stok × modalnya",
    },
    {
      code: "1501", nama: "Aset Tetap", sisi: "D",
      nyata: asetNyata, buku: saldo("1501"),
      selisih: selisihSaldoAwal(asetNyata, saldo("1501")),
      sumber: "Total harga perolehan aset aktif",
    },
    {
      // 1509 kontra-aset: saldo normalnya kredit, jadi 'nyata' dibandingkan apa adanya.
      code: "1509", nama: "Akumulasi Penyusutan", sisi: "K",
      nyata: akumNyata, buku: saldo("1509"),
      selisih: selisihSaldoAwal(akumNyata, saldo("1509")),
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

/** Posting saldo awal: satu jurnal, selisihnya otomatis ke Modal Pemilik. */
export async function simpanSaldoAwal(formData: FormData) {
  const supabase = await createClient();
  const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) gagal("Tanggal saldo awal tidak valid.");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  let baris: BarisSaldoAwal[] = [];
  try {
    baris = JSON.parse(String(formData.get("baris") ?? "[]")) as BarisSaldoAwal[];
  } catch {
    baris = [];
  }
  baris = baris.filter((b) => b.code?.trim() && Number(b.nilai));
  if (baris.length === 0) gagal("Isi minimal satu baris saldo awal.");

  const { lines, modal } = jurnalSaldoAwal(baris);
  if (lines.length === 0) gagal("Semua nilai nol — tidak ada yang perlu diposting.");

  // Semua kode akun wajib ada, termasuk akun modalnya.
  const codes = [...new Set(lines.map((l) => l.code))];
  const { data: accounts } = await supabase.from("coa_accounts").select("id, code").in("code", codes);
  const codeToId = new Map((accounts ?? []).map((a) => [a.code as string, a.id as string]));
  for (const c of codes) if (!codeToId.has(c)) gagal(`Akun ${c} tidak ada di daftar akun.`);

  // Saldo awal hanya boleh satu (dijaga juga unique index di DB). Yang lama dihapus
  // supaya angkanya bisa dikoreksi sebelum go-live tanpa menumpuk jurnal ganda.
  const { data: lama } = await supabase
    .from("journal_entries").select("id").eq("source", "saldo-awal");
  for (const l of lama ?? []) await supabase.from("journal_entries").delete().eq("id", l.id);

  // Posting langsung (bukan postJournal best-effort) — saldo awal wajib ketahuan gagalnya.
  const prefix = `${prefixJurnal(tanggal)}-`;
  const no_jurnal = formatNomor(prefix, await nextSeqJurnal(supabase, tanggal), 4);

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .insert({
      no_jurnal, tanggal, deskripsi: `Saldo awal per ${tanggal}`,
      source: "saldo-awal", source_ref: tanggal, branch_id: null,
    })
    .select("id").single();
  if (entryErr || !entry) gagal(`Gagal menyimpan saldo awal: ${entryErr?.message ?? "tidak diketahui"}`);

  const { error: lineErr } = await supabase.from("journal_lines").insert(
    lines.map((l) => ({ entry_id: entry!.id, account_id: codeToId.get(l.code), debit: l.debit, credit: l.credit })),
  );
  if (lineErr) {
    await supabase.from("journal_entries").delete().eq("id", entry!.id);
    gagal(`Gagal menyimpan baris saldo awal: ${lineErr.message}`);
  }

  revalidatePath(BACK);
  const arah = modal >= 0 ? "Modal Pemilik" : "defisit modal";
  redirect(`${BACK}?success=${encodeURIComponent(
    `Saldo awal per ${tanggal} tersimpan (${no_jurnal}) — selisih Rp ${Math.abs(modal).toLocaleString("id-ID")} masuk ${arah} (${AKUN_MODAL_PEMILIK}).`,
  )}`);
}

/** Hapus saldo awal (koreksi sebelum go-live). */
export async function hapusSaldoAwal() {
  const supabase = await createClient();
  const { data: lama } = await supabase.from("journal_entries").select("id, tanggal").eq("source", "saldo-awal");
  for (const l of lama ?? []) {
    const pesan = await cekPeriode(supabase, l.tanggal as string);
    if (pesan) redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);
    await supabase.from("journal_entries").delete().eq("id", l.id);
  }
  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent("Saldo awal dihapus — silakan isi ulang.")}`);
}
