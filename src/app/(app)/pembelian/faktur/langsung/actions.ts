"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { buildFakturLangsungLines, formatNoFaktur } from "@/lib/faktur-beli";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { stockIn } from "@/lib/inventory";
import { loadUnitOptions, pickUnit, toBaseQty, toBaseCost } from "@/lib/satuan";
import { prefixBulanan, urutanBerikutnya, ymDari } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { parseLampiran } from "@/lib/dokumen";
import { cekPeriode } from "@/lib/jurnal-guard";
import { jurnalTersimpan } from "@/lib/jurnal-guard";

const BARU = "/pembelian/faktur/langsung";
const LIST = "/pembelian/faktur";

type BarisInput = { item_id: string; qty: number; harga: number; satuan?: string; exp_date?: string };

/**
 * Faktur Pembelian Langsung — beli barang tanpa PO, barang masuk di dokumen yang sama.
 *
 * Sengaja BUKAN "faktur kosong": kalau faktur tidak membawa barang masuk, akan ada
 * tagihan yang barangnya tidak ketahuan ke mana. Karena itu gudang tujuan wajib
 * dipilih dan stok langsung bertambah di sini.
 *
 * Yang TIDAK dibuat: dokumen penerimaan (goods_receipts). Tabel itu menuntut PO dan
 * kebijakan aksesnya menyaring lewat PO, jadi mustahil tanpa merombaknya — sementara
 * jejak barang masuknya sudah dijamin Kartu Stok yang ditulis otomatis oleh stockIn.
 */
export async function buatFakturLangsung(formData: FormData) {
  const supabase = await createClient();
  const gagal: (msg: string) => never = (msg) => redirect(`${BARU}?error=${encodeURIComponent(msg)}`);

  const supplier_id = String(formData.get("supplier_id") ?? "").trim();
  const warehouse_id = String(formData.get("warehouse_id") ?? "").trim();
  const no_faktur_pemasok = String(formData.get("no_faktur_pemasok") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const jatuh_tempo = String(formData.get("jatuh_tempo") ?? "").trim() || tanggal;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;
  const surat_jalan = String(formData.get("surat_jalan") ?? "").trim().slice(0, 60) || null;
  const lampiran = parseLampiran(formData.get("lampiran"));

  if (!supplier_id) gagal("Pilih pemasok dulu.");
  if (!warehouse_id) gagal("Pilih gudang tujuan — barangnya harus masuk ke suatu tempat.");

  let items: BarisInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as BarisInput[]; } catch { items = []; }
  items = items.filter((it) => it.item_id && Number(it.qty) > 0 && Number(it.harga) >= 0);
  if (items.length === 0) gagal("Isi minimal 1 barang dengan jumlah lebih dari 0.");

  // Jurnal WAJIB bisa terbit. postJournal menelan error, jadi periode terkunci dicek
  // lebih dulu — kalau tidak, stok bertambah & utang tercatat tanpa jurnal apa pun.
  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: gudang } = await supabase
    .from("warehouses").select("id, branch_id").eq("id", warehouse_id).eq("is_active", true).maybeSingle();
  if (!gudang) gagal("Gudang tidak ditemukan atau sudah nonaktif.");

  // Satuan & faktor DITETAPKAN ULANG dari master: faktor kiriman klien tidak boleh
  // dipercaya — faktor palsu bikin stok bertambah lebih banyak dari yang dibeli.
  const ids = [...new Set(items.map((i) => i.item_id))];
  const [{ data: master }, unitMap] = await Promise.all([
    supabase.from("items").select("id, name, item_type").in("id", ids),
    loadUnitOptions(supabase, ids),
  ]);
  const namaMap = new Map(((master ?? []) as { id: string; name: string; item_type: string }[])
    .map((m) => [m.id, m]));

  const rows = items.map((it) => {
    const m = namaMap.get(it.item_id);
    const u = pickUnit(unitMap.get(it.item_id) ?? [], it.satuan);
    const exp = String(it.exp_date ?? "").trim();
    return {
      item_id: it.item_id,
      nama: (m?.name ?? "").slice(0, 160) || "—",
      berstok: (m?.item_type ?? "Persediaan") === "Persediaan",
      qty: Number(it.qty),
      harga: Number(it.harga) || 0,
      satuan: u.unit,
      faktor: u.factor,
      exp_date: /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null,
    };
  });
  if (rows.some((r) => !namaMap.has(r.item_id))) gagal("Ada barang yang tidak ada di master — pilih ulang dari daftar.");
  if (rows.some((r) => !r.berstok)) {
    gagal("Faktur langsung khusus BARANG yang masuk gudang. Tagihan jasa/biaya dicatat lewat Buku Besar → Pencatatan Beban.");
  }

  const total = rows.reduce((a, r) => a + r.qty * r.harga, 0);
  if (total <= 0) gagal("Nilai faktur nol.");

  const no_faktur = await nextNoFakturLangsung(supabase);
  const { data: { user } } = await supabase.auth.getUser();

  const { data: doc, error } = await supabase
    .from("purchase_invoices")
    .insert({
      no_faktur, no_faktur_pemasok, po_id: null, supplier_id,
      branch_id: gudang.branch_id, warehouse_id, surat_jalan,
      tanggal, jatuh_tempo, total, keterangan, created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error || !doc) gagal(`Gagal menyimpan faktur: ${error?.message ?? "unknown"}`);

  const { error: itemsErr } = await supabase.from("purchase_invoice_items").insert(
    rows.map((r) => ({
      invoice_id: doc!.id, item_id: r.item_id, nama: r.nama,
      qty: r.qty, harga: r.harga, satuan: r.satuan, faktor: r.faktor, exp_date: r.exp_date,
    })),
  );
  if (itemsErr) {
    await supabase.from("purchase_invoices").delete().eq("id", doc!.id);
    gagal("Gagal menyimpan rincian faktur.");
  }

  // Berkas surat jalan / nota pemasok menempel ke fakturnya.
  if (lampiran.length) {
    await supabase.from("document_attachments").insert(
      lampiran.map((l) => ({ ...l, modul: "pembelian", ref_id: doc!.id, uploaded_by: user?.id ?? null })),
    );
  }

  // Persediaan dinilai sebesar DPP — PPN Masukan bisa dikreditkan, jadi bukan bagian
  // harga pokok barang. Nilai lapisan stok memakai dasar yang SAMA supaya saldo
  // Persediaan di buku besar dan nilai stok riil tidak berpisah. Mode PKP mati →
  // dpp = total, jadi tidak ada bedanya.
  const { dpp, ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  const rasioDpp = total > 0 ? dpp / total : 1;

  try {
    for (const r of rows) {
      await stockIn(supabase, {
        warehouseId: warehouse_id, itemId: r.item_id,
        qty: toBaseQty(r.qty, r.faktor),
        unitCost: toBaseCost(r.harga * rasioDpp, r.faktor),
        // Sumber dibedakan dari "purchase" supaya faktur PO tidak ikut menyesuaikan
        // harga lapisan milik faktur langsung.
        source: "faktur-langsung", ref: no_faktur,
        tanggal, expDate: r.exp_date,
      });
    }
  } catch (e) {
    await supabase.from("purchase_invoices").delete().eq("id", doc!.id);
    gagal(`Faktur dibatalkan — stok gagal ditambah (${e instanceof Error ? e.message : "gagal"}).`);
  }

  await postJournal(supabase, {
    tanggal,
    deskripsi: `Faktur pembelian langsung ${no_faktur}`,
    source: "purchase-invoice",
    sourceRef: no_faktur,
    branchId: gudang.branch_id,
    lines: buildFakturLangsungLines(total, ppn),
  });

  // postJournal best-effort: untuk uang yang berpindah, keberadaan jurnalnya wajib
  // diverifikasi. Stok sudah bertambah di sini, jadi kalau jurnalnya tidak ada,
  // fakturnya dibatalkan supaya tidak ada utang tanpa pembukuan.
  if (!(await jurnalTersimpan(supabase, "purchase-invoice", no_faktur))) {
    await supabase.from("purchase_invoices").delete().eq("id", doc!.id);
    gagal("Faktur dibatalkan — jurnalnya gagal tersimpan. Coba lagi, dan laporkan kalau berulang.");
  }

  revalidatePath(LIST);
  revalidatePath("/keuangan/hutang");
  redirect(`${LIST}?success=${encodeURIComponent(`Faktur ${no_faktur} tersimpan — stok sudah bertambah.`)}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextNoFakturLangsung(supabase: any) {
  const now = new Date();
  const seq = await urutanBerikutnya(supabase, {
    table: "purchase_invoices", column: "no_faktur",
    prefix: prefixBulanan("FB", ymDari(now)), pad: 5,
  });
  return formatNoFaktur(now, seq);
}
