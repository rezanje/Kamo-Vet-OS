"use server";

// ponytail: server actions — buatPO, tambahSupplier, updatePOStatus (+ receiving logic).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { stockIn } from "@/lib/inventory";
import { hitungBarisTerima, nilaiDiterima } from "@/lib/penerimaan";
import { loadUnitOptions, pickUnit, toBaseCost, toBaseQty } from "@/lib/satuan";
import { normalisasiBatch, type BatchInput } from "@/lib/kadaluarsa-batch";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { tanggalLokal } from "@/lib/tanggal";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextNoTerima(supabase: any): Promise<string> {
  const { nomor } = await nomorBerikutnya(supabase, "TB", tanggalLokal(new Date()), {
    table: "goods_receipts", column: "no_terima",
  });
  return nomor;
}

type ItemInput = {
  nama: string; qty: number; harga_beli: number; item_id?: string | null;
  satuan?: string | null; faktor?: number;
};

// ─── Buat PO ──────────────────────────────────────────────────────────────────

export async function buatPO(formData: FormData) {
  const supabase = await createClient();

  const supplier_id = String(formData.get("supplier_id") ?? "").trim() || null;
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "").trim() || null;
  const branch_id = String(formData.get("branch_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();

  let items: ItemInput[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[];
  } catch {
    items = [];
  }
  items = items.filter((it) => (it.nama ?? "").trim().length > 0);

  if (!to_warehouse_id || !branch_id || items.length === 0) {
    redirect("/pembelian/baru?error=" + encodeURIComponent("Gudang, cabang, dan minimal 1 item wajib diisi."));
  }

  // Formatnya dibaca dari master penomoran; bawaannya PO-YYYYMMDD-NNNN,
  // dilanjutkan dari nomor tertinggi hari itu.
  const { nomor: no_po } = await nomorBerikutnya(supabase, "PO", tanggal, {
    table: "purchase_orders", column: "no_po",
  });

  // compute total
  const total = items.reduce((acc, it) => acc + (Number(it.qty) || 0) * (Number(it.harga_beli) || 0), 0);

  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({ no_po, supplier_id, to_warehouse_id, branch_id, tanggal, total, status: "Draft" })
    .select("id")
    .single();

  if (poErr || !po) {
    redirect("/pembelian/baru?error=" + encodeURIComponent("Gagal membuat PO."));
  }

  const poId = (po as { id: string }).id;
  // Satuan beli (box/sak) diambil ulang dari master — faktor dari form tidak dipercaya,
  // karena faktor palsu bikin stok masuk lebih banyak dari barang yang benar-benar datang.
  const unitOpts = await loadUnitOptions(supabase, items.map((it) => it.item_id).filter((x): x is string => !!x));
  const rows = items.map((it) => {
    const opts = it.item_id ? unitOpts.get(it.item_id) : undefined;
    const u = opts ? pickUnit(opts, it.satuan) : null;
    return {
      po_id: poId,
      item_id: it.item_id || null,   // link master SKU → stok bertambah saat Diterima & bisa diretur
      nama: String(it.nama).slice(0, 160),
      qty: Number(it.qty) || 0,
      harga_beli: Number(it.harga_beli) || 0,
      satuan: u?.unit ?? null,
      faktor: u?.factor ?? 1,
    };
  });
  await supabase.from("purchase_order_items").insert(rows);

  revalidatePath("/pembelian");
  redirect("/pembelian?success=1");
}

// ─── Tambah Supplier ──────────────────────────────────────────────────────────

export async function tambahSupplier(formData: FormData) {
  const supabase = await createClient();
  const nama = String(formData.get("nama") ?? "").trim();
  const kontak = String(formData.get("kontak") ?? "").trim() || null;
  const telp = String(formData.get("telp") ?? "").trim() || null;
  const alamat = String(formData.get("alamat") ?? "").trim() || null;
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
  const npwp = String(formData.get("npwp") ?? "").trim() || null;
  const bankNama = String(formData.get("bank_nama") ?? "").trim() || null;
  const bankRekening = String(formData.get("bank_rekening") ?? "").trim() || null;
  const bankAtasNama = String(formData.get("bank_atas_nama") ?? "").trim() || null;

  const terminRaw = formData.get("termin_hari");
  const termin = terminRaw === null || String(terminRaw).trim() === "" ? 30 : Number(terminRaw);

  if (!nama) {
    redirect("/pembelian?error=" + encodeURIComponent("Nama supplier wajib diisi."));
  }
  if (!Number.isFinite(termin) || termin < 0) {
    redirect("/pembelian?error=" + encodeURIComponent("Termin pembayaran tidak valid."));
  }

  await supabase.from("suppliers").insert({
    nama, kontak, telp, alamat, category_id: categoryId,
    npwp, termin_hari: termin, bank_nama: bankNama,
    bank_rekening: bankRekening, bank_atas_nama: bankAtasNama,
  });

  revalidatePath("/pembelian");
  redirect("/pembelian?tab=supplier&success_sup=1");
}

// ─── Update PO Status (+ receiving logic) ─────────────────────────────────────

export async function updatePOStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const newStatus = String(formData.get("status") ?? "");

  // ponytail: fetch PO + current status before changing anything.
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, total, to_warehouse_id, branch_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!po) {
    revalidatePath("/pembelian");
    return;
  }

  const currentStatus = (po as { status: string }).status;

  // Penerimaan barang punya halamannya sendiri (qty datang bisa ≠ qty PO).
  if (newStatus === "Diterima") {
    if (currentStatus === "Diterima") {
      revalidatePath("/pembelian");
      return;
    }
    redirect(`/pembelian/${id}/terima`);
  }

  await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", id);

  revalidatePath("/pembelian");
}

// ─── Terima Barang (qty diterima boleh ≠ qty PO) ──────────────────────────────

type TerimaInput = {
  id: string; qty_terima: number; qty_rusak?: number; catatan?: string; exp_date?: string;
  /** Jumlah per tanggal kadaluarsa — satu kiriman bisa beberapa masa simpan. */
  batches?: BatchInput[];
};

export async function terimaBarang(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "").trim() || hariIniWIB();
  const suratJalan = String(formData.get("surat_jalan") ?? "").trim() || null;
  const catatanDok = String(formData.get("catatan") ?? "").trim() || null;

  const fail = (msg: string) =>
    redirect(`/pembelian/${id}/terima?error=` + encodeURIComponent(msg));

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) fail(pesanPeriode);

  let input: TerimaInput[] = [];
  try {
    input = JSON.parse(String(formData.get("rows") ?? "[]")) as TerimaInput[];
  } catch {
    input = [];
  }

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, to_warehouse_id, branch_id, status, purchase_order_items(id, item_id, nama, satuan, qty, qty_terima, qty_rusak, faktor, harga_beli)")
    .eq("id", id)
    .maybeSingle();

  if (!po) fail("PO tidak ditemukan.");
  if (po!.status === "Batal") fail("PO batal tidak bisa diterima.");

  const poItems = (po!.purchase_order_items ?? []) as {
    id: string; item_id: string | null; nama: string; satuan: string | null;
    qty: number; qty_terima: number | null; qty_rusak: number | null;
    faktor: number | null; harga_beli: number;
  }[];

  // Penerimaan boleh BERTAHAP: pemasok sering mengirim sisa beberapa hari
  // kemudian. Angka di form = qty yang datang KALI INI, ditambahkan ke yang
  // sudah pernah diterima, dan tidak boleh melewati qty PO.
  const inputById = new Map(input.map((r) => [r.id, r]));
  const rows = poItems.map((r) => {
    const dari = inputById.get(r.id);
    const sudah = Number(r.qty_terima) || 0;
    const h = hitungBarisTerima({
      qty: Number(r.qty),
      sudahTerima: sudah,
      // Baris yang tidak dikirim form dianggap datang penuh (perilaku lama).
      mintaTerima: dari ? Number(dari.qty_terima) : Math.max(0, Number(r.qty) - sudah),
      mintaRusak: dari ? Number(dari.qty_rusak ?? 0) : 0,
      harga: Number(r.harga_beli) || 0,
    });
    // Kadaluarsa dicatat per baris: satu kiriman bisa berisi obat dengan masa
    // simpan berbeda-beda.
    const exp = (dari?.exp_date ?? "").trim();
    const expDate = /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null;
    // Beberapa tanggal dalam satu baris: dirapikan di sini supaya jumlah lapisan
    // yang dibuat selalu pas dengan qty yang diterima.
    const batches = normalisasiBatch(
      h.terima,
      dari?.batches?.length ? dari.batches : (expDate ? [{ qty: h.terima, exp_date: expDate }] : []),
    );
    return {
      ...r, ...h, kaliIni: h.terima, catatan: dari?.catatan?.trim() || null,
      expDate, batches,
    };
  });

  if (rows.every((r) => r.terima <= 0 && r.rusak <= 0)) {
    fail("Tidak ada barang yang diterima. Batalkan PO kalau kiriman tidak datang.");
  }

  for (const r of rows) {
    if (r.terima <= 0 && r.rusak <= 0) continue;
    await supabase.from("purchase_order_items").update({
      qty_terima: r.totalTerima,
      qty_rusak: (Number(r.qty_rusak) || 0) + r.rusak,
    }).eq("id", r.id);
  }

  // Dokumen penerimaan bernomor (migrasi 0093): tiap kiriman punya jejaknya
  // sendiri — kapan datang, diterima siapa, mana yang rusak.
  const { data: { user } } = await supabase.auth.getUser();
  const noTerima = await nextNoTerima(supabase);
  const { data: dokumen } = await supabase
    .from("goods_receipts")
    .insert({
      no_terima: noTerima, po_id: id, tanggal,
      surat_jalan: suratJalan, catatan: catatanDok, received_by: user?.id ?? null,
    })
    .select("id").single();

  if (dokumen) {
    await supabase.from("goods_receipt_items").insert(
      rows.filter((r) => r.terima > 0 || r.rusak > 0).map((r) => ({
        receipt_id: dokumen.id,
        po_item_id: r.id,
        item_id: r.item_id,
        nama: r.nama,
        satuan: r.satuan,
        qty_pesan: Number(r.qty),
        qty_sisa_sebelum: r.sisaSebelum,
        qty_terima: r.terima,
        qty_rusak: r.rusak,
        harga: Number(r.harga_beli) || 0,
        catatan: r.catatan,
        exp_date: r.expDate,
        // Jejak audit: rincian jumlah per tanggal, walau lapisannya nanti habis.
        batches: r.batches.length > 1 ? r.batches : null,
      })),
    );
  }

  // Stok masuk via lib FIFO: layer baru @ harga_beli PO (sumber cost utama HPP).
  const warehouseId = po!.to_warehouse_id as string | null;
  const noPo = (po!.no_po as string | null) ?? id;
  if (warehouseId) {
    for (const r of rows) {
      if (!r.item_id || r.kaliIni <= 0) continue;
      // Satu lapisan per tanggal kadaluarsa. Kiriman satu tanggal tetap
      // menghasilkan satu lapisan seperti dulu.
      for (const b of r.batches) {
        // qty diinput dalam satuan baris PO (bisa box/sak) → konversi ke satuan dasar stok
        await stockIn(supabase, {
          warehouseId, itemId: r.item_id, qty: toBaseQty(b.qty, r.faktor ?? 1),
          unitCost: toBaseCost(Number(r.harga_beli) || 0, r.faktor ?? 1),
          source: "purchase", ref: noPo, expDate: b.expDate,
        });
      }
    }
  }

  // Jurnal senilai barang yang datang KALI INI saja — penerimaan sebelumnya
  // sudah punya jurnalnya sendiri.
  // Barang rusak tidak ikut: belum jadi persediaan dan belum jadi hutang.
  const total = nilaiDiterima(rows.map((r) => ({ qty: r.kaliIni, qty_terima: r.kaliIni, harga_beli: r.harga_beli })));
  if (total > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Penerimaan barang ${noTerima} (${noPo})`,
      source: "purchase",
      sourceRef: noPo,
      branchId: (po!.branch_id as string | null) ?? null,
      // hutang usaha (2101) baru lahir saat Faktur Pembelian; saat terima barang
      // masuk akun antara 2102 Hutang Belum Difakturkan (ala Accurate/GRNI).
      lines: [
        { code: "1301", debit: total, credit: 0 },
        { code: "2102", debit: 0, credit: total },
      ],
    });
  }

  // PO baru dianggap tuntas kalau SEMUA baris sudah datang penuh; selama masih
  // ada sisa, statusnya tetap "Dipesan" supaya tombol Terima Barang tidak hilang
  // dan sisa kiriman masih bisa dicatat.
  const lengkap = rows.every((r) => r.totalTerima >= Number(r.qty));
  await supabase.from("purchase_orders").update({ status: lengkap ? "Diterima" : "Dipesan" }).eq("id", id);

  revalidatePath("/pembelian");
  revalidatePath("/pembelian/penerimaan");
  revalidatePath("/keuangan/hutang");

  const adaRusak = rows.some((r) => r.rusak > 0);
  const pesan = lengkap
    ? `Barang ${noPo} diterima lengkap — dokumen ${noTerima}.`
    : `Sebagian barang ${noPo} diterima (dokumen ${noTerima}) — sisanya masih bisa dicatat nanti.`;
  redirect("/pembelian?success_terima=" + encodeURIComponent(
    adaRusak ? `${pesan} Barang rusak tercatat untuk klaim ke pemasok.` : pesan,
  ));
}
