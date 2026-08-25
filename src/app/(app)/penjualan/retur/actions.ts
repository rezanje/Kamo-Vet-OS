"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import {
  sisaRetur, totalRetur, rasioBayar, hargaRefund,
  modalPerBarang, pisahModalRetur, bolehMasukStok,
} from "@/lib/retur";
import { stockIn } from "@/lib/inventory";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { kodeAkunBayar, kodeKasJurnalAsal } from "@/lib/kas-akun";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { cekPeriode } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/tanggal";

type ItemInput = { item_id: string; qty: number; kondisi?: string; exp_date?: string };

type Db = Awaited<ReturnType<typeof createClient>>;

// Retur Penjualan: barang balik dari pelanggan, refund tunai di kasir.
// Refund dicatat sebagai expenses (Tunai, shift open cabang bila ada) → kepotong di tutup shift.
// Jurnal: Dr 4101 Pendapatan, Cr 1101 Kas (refund) + Dr 1301 Persediaan, Cr 5101 HPP (stok balik).
export async function buatReturJual(formData: FormData) {
  const supabase = await createClient();

  const sale_id = String(formData.get("sale_id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  // Dipakai dua dunia: backoffice (/penjualan/retur) & layar kasir (/kasir/retur).
  // Kasir mengirim lock_branch_id supaya tidak bisa meretur struk cabang lain.
  const kasir = String(formData.get("dari") ?? "") === "kasir";
  const lockBranchId = String(formData.get("lock_branch_id") ?? "").trim();
  const formHref = kasir ? "/kasir/retur" : "/penjualan/retur/baru";
  const listHref = kasir ? "/kasir/retur" : "/penjualan/retur";

  let items: ItemInput[] = [];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[]; } catch { items = []; }
  // Kondisi & tanggal dari klien dibersihkan di sini: kondisi hanya boleh dua nilai,
  // dan tanggal harus benar-benar berbentuk tanggal (pola sama dengan penerimaan
  // pembelian) — kalau tidak, nilai sembarang bisa masuk kolom dan lolos ke stok.
  items = items
    .filter((it) => it.item_id && Number(it.qty) > 0)
    .map((it) => {
      const exp = String(it.exp_date ?? "").trim();
      return {
        item_id: it.item_id,
        qty: Number(it.qty),
        kondisi: String(it.kondisi ?? "baik").toLowerCase() === "rusak" ? "rusak" : "baik",
        exp_date: /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : undefined,
      };
    });

  const fail = (msg: string) => redirect(`${formHref}?error=` + encodeURIComponent(msg));

  if (!sale_id || items.length === 0) fail("Pilih struk dan minimal 1 barang.");

  // Periode terkunci dicek DULU: trigger DB melempar error dan postJournal menelannya,
  // jadi tanpa ini dokumen retur + refund kasir tersimpan tanpa jurnal apa pun.
  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) fail(pesanPeriode);

  // channel bukan null = order online (Shopee/Tokopedia/TikTok/WA) — retur kasir tunai tidak
  // berlaku di situ (tidak ada kas fisik yang diterima dari channel itu di cabang manapun).
  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, branch_id, subtotal, total, metode_bayar, sale_items(item_id, qty, harga, faktor, hpp)")
    .eq("id", sale_id).is("channel", null).single();
  if (!sale) fail("Struk tidak ditemukan, atau merupakan order online — retur online tidak didukung di sini.");
  if (lockBranchId && sale!.branch_id !== lockBranchId) {
    fail("Struk ini bukan penjualan cabang kamu — retur hanya bisa di cabang tempat barang dijual.");
  }

  // qty terjual & harga per item dari struk — dinormalkan ke SATUAN DASAR, karena
  // satu struk bisa memuat item yang sama dalam dua satuan (1 box + 3 pcs).
  const sumber: Record<string, number> = {};
  const harga: Record<string, number> = {};
  const modal: Record<string, number> = {};   // modal per SATUAN DASAR saat terjual

  // Refund harus sebanding dengan yang benar-benar dibayar. Struk bisa kena
  // promo, diskon golongan, voucher, dan poin — memakai harga daftar berarti
  // pelanggan yang belanja pakai diskon lalu meretur semuanya menerima uang
  // LEBIH BANYAK daripada yang ia keluarkan.
  const rasio = rasioBayar(Number(sale!.subtotal), Number(sale!.total));

  for (const r of sale!.sale_items ?? []) {
    if (!r.item_id) continue;
    const f = Number(r.faktor) > 0 ? Number(r.faktor) : 1;
    const qtyDasar = Number(r.qty) * f;
    sumber[r.item_id] = (sumber[r.item_id] ?? 0) + qtyDasar;
    harga[r.item_id] = hargaRefund((Number(r.harga) || 0) / f, rasio);
  }
  // Modal diambil dari HPP yang tercatat saat barang itu keluar (0084), bukan dari
  // harga beli master yang bisa sudah basi — dan dijumlahkan dulu PER BARANG.
  // Sejak satuan berjenjang ada, "1 box + 3 pcs" barang yang sama itu dua baris;
  // menghitungnya per baris membuat baris terakhir menimpa yang lain dan modalnya
  // meleset berkali-kali lipat.
  Object.assign(modal, modalPerBarang(
    (sale!.sale_items ?? []).map((r) => ({
      item_id: r.item_id,
      qtyDasar: Number(r.qty) * (Number(r.faktor) > 0 ? Number(r.faktor) : 1),
      hpp: r.hpp,
    })),
  ));

  // akumulasi retur sebelumnya utk struk ini
  const { data: prev } = await supabase
    .from("sales_returns").select("no_retur, sales_return_items(item_id, qty)").eq("sale_id", sale_id);
  const sudah: Record<string, number> = {};
  for (const d of prev ?? [])
    for (const r of d.sales_return_items ?? [])
      if (r.item_id) sudah[r.item_id] = (sudah[r.item_id] ?? 0) + Number(r.qty);

  const sisa = sisaRetur(sumber, sudah);
  // Sisa 0 hampir selalu berarti "struk ini sudah pernah diretur", bukan salah ketik
  // qty. Pesan lama ("melebihi sisa yang bisa diretur (sisa 0)") membuat orang mengira
  // returnya gagal padahal yang pertama berhasil — nomor returnya disebut supaya jelas.
  const noReturSebelumnya = ((prev ?? []) as { no_retur?: string }[])
    .map((d) => d.no_retur).filter(Boolean).join(", ");
  for (const it of items) {
    const sisaIni = sisa[it.item_id] ?? 0;
    if (sisaIni < Number(it.qty)) {
      fail(sisaIni === 0
        ? `Struk ini sudah diretur seluruhnya${noReturSebelumnya ? ` lewat ${noReturSebelumnya}` : ""} — tidak ada lagi yang bisa dikembalikan.`
        : `Qty retur melebihi sisa yang bisa diretur (sisa ${sisaIni}).`);
    }
  }

  // Refund TIDAK dipengaruhi kondisi barang: pelanggan tetap menerima uangnya penuh
  // walau barangnya rusak. Yang berbeda cuma nasib barangnya di gudang kita.
  const rows = items.map((it) => ({
    item_id: it.item_id, qty: Number(it.qty), harga: harga[it.item_id] ?? 0,
    kondisi: it.kondisi ?? "baik", exp_date: it.exp_date ?? null,
  }));
  const total = totalRetur(rows);
  if (total <= 0) fail("Nilai retur nol.");

  const { data: { user } } = await supabase.auth.getUser();
  const no_retur = await nextNoRetur(supabase);

  const { data: itemNames } = await supabase
    .from("items").select("id, name, buy_price, item_type").in("id", items.map((it) => it.item_id));
  const nameMap = new Map((itemNames ?? []).map((r) => [r.id, r]));

  const { data: doc, error } = await supabase
    .from("sales_returns")
    .insert({ no_retur, sale_id, tanggal, keterangan, total, created_by: user?.id ?? null })
    .select("id").single();
  if (error || !doc) fail("Gagal menyimpan retur.");

  const { error: itemsErr } = await supabase.from("sales_return_items").insert(
    rows.map((r) => ({
      return_id: doc!.id, item_id: r.item_id,
      nama: (nameMap.get(r.item_id)?.name ?? "").slice(0, 160) || "—",
      qty: r.qty, harga: r.harga,
      kondisi: r.kondisi, exp_date: r.exp_date,
    })),
  );
  if (itemsErr) {
    console.error("retur jual: gagal insert rincian", itemsErr);
    await supabase.from("sales_returns").delete().eq("id", doc!.id);
    fail("Gagal menyimpan rincian retur.");
  }

  // Refund dikembalikan lewat jalur yang sama dengan pembayarannya. Struk transfer/QRIS
  // tidak mengurangi laci kasir, jadi hanya refund TUNAI yang ditempel ke shift.
  // Refund tunai ditempel ke laci ORANG YANG MENGERJAKANNYA, bukan ke sembarang
  // shift yang kebetulan terbuka di cabang itu. Versi lama membebani kasir yang
  // sedang jaga atas refund yang diproses orang backoffice — kasir itu lalu kena
  // selisih kurang atas uang yang tidak pernah keluar dari lacinya.
  //
  // Kalau yang memproses tidak punya shift terbuka, uangnya memang tidak keluar
  // dari laci mana pun (dibayar dari meja keuangan), jadi tidak ditempel ke shift.
  const metodeRefund = String(sale!.metode_bayar ?? "Tunai");
  const { data: shift } = metodeRefund === "Tunai" && user?.id
    ? await supabase
        .from("cashier_shifts").select("id")
        .eq("branch_id", sale!.branch_id).eq("status", "open")
        .eq("opened_by", user.id).eq("shift_type", "petshop")
        .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null as { id: string } | null };
  const { error: expErr } = await supabase.from("expenses").insert({
    branch_id: sale!.branch_id,
    tanggal,
    kategori: "Retur Penjualan",
    deskripsi: `Refund retur ${no_retur} (struk ${sale!.no_struk ?? sale_id})`,
    jumlah: total,
    metode_bayar: metodeRefund,
    shift_id: shift?.id ?? null,
    created_by: user?.id ?? null,
  });
  if (expErr) {
    // duit gak boleh gagal diam-diam — batalkan dokumen (items ikut cascade)
    console.error("retur jual: gagal catat refund", expErr);
    await supabase.from("sales_returns").delete().eq("id", doc!.id);
    fail("Gagal mencatat refund kasir.");
  }

  // stok balik ke gudang cabang penjualan (logika gudang sama dgn checkout kasir)
  const { data: wh } = await supabase
    .from("warehouses").select("id")
    .eq("branch_id", sale!.branch_id).eq("is_active", true)
    .order("type").limit(1).maybeSingle();
  // Jasa (grooming, konsultasi) boleh diretur — uangnya dikembalikan — tapi TIDAK
  // punya stok. Tanpa saringan ini, membatalkan jasa malah menambah persediaan.
  const berstok = (id: string) => (nameMap.get(id)?.item_type ?? "Persediaan") === "Persediaan";
  // Modal barang yang kembali = modal saat barang itu KELUAR. Kalau memakai
  // harga beli master, tiap retur menambah nilai persediaan dari udara —
  // di simulasi keluar Rp200.000 lalu masuk lagi Rp210.000.
  const modalSatuan = (id: string) =>
    modal[id] > 0 ? modal[id] : (Number(nameMap.get(id)?.buy_price) || 0);

  // Cabang tanpa gudang aktif = barangnya tidak punya tempat pulang. Kalau tetap
  // dilanjutkan, jurnal HPP di bawah akan menambah nilai Persediaan yang secara
  // fisik tidak pernah masuk — buku dan gudang langsung berbeda.
  if (!wh) {
    await supabase.from("sales_returns").delete().eq("id", doc!.id);
    fail("Cabang ini belum punya gudang aktif — barang retur tidak bisa diterima. Hubungi admin.");
  }

  // HANYA barang berkondisi "baik" yang kembali jadi stok jualan. Barang rusak /
  // kadaluarsa sengaja TIDAK dimasukkan: kalau dimasukkan, barang basi berdiri
  // sebagai stok normal dan bisa terjual lagi (dilaporkan tim 2026-08-12).
  //
  // Kadaluarsa diisi manual dari form — tidak bisa dipulihkan otomatis karena
  // sale_items tidak menyimpan exp_date lapisan yang dulu terpakai.
  try {
    for (const r of rows) {
      if (!berstok(r.item_id)) continue;
      if (!bolehMasukStok(r.kondisi)) continue;
      await stockIn(supabase, {
        warehouseId: wh!.id as string, itemId: r.item_id, qty: r.qty,
        unitCost: modalSatuan(r.item_id),
        source: "retur-jual", ref: no_retur,
        tanggal,          // lapisan & kartu stok ikut tanggal retur, bukan hari ini
        expDate: r.exp_date,
      });
    }
  } catch (e) {
    // Stok gagal ditulis = dokumen tidak boleh berdiri. Refund yang sudah tercatat
    // ikut dibersihkan supaya tidak ada uang keluar tanpa barang masuk.
    console.error("retur jual: gagal kembalikan stok", e);
    await supabase.from("expenses").delete()
      .eq("deskripsi", `Refund retur ${no_retur} (struk ${sale!.no_struk ?? sale_id})`);
    await supabase.from("sales_returns").delete().eq("id", doc!.id);
    fail(`Retur dibatalkan — stok gagal diperbarui (${e instanceof Error ? e.message : "gagal"}).`);
  }

  // Jurnal refund = kebalikan persis jurnal penjualannya:
  //  - uang keluar dari rekening yang DIPAKAI jurnal aslinya (bukan selalu 1101 Kas —
  //    struk transfer/QRIS dulu masuk ke bank, refundnya harus keluar dari sana juga);
  //  - kalau mode PKP aktif, PPN Keluaran ikut dibalik, bukan cuma pendapatannya.
  const kasCode = await kodeKasJurnalAsal(
    supabase, "sale", sale!.no_struk ?? sale_id,
    await kodeAkunBayar(supabase, metodeRefund, sale!.branch_id ?? null),
  );
  const { dpp: dppRetur, ppn: ppnRetur } = splitPpnInklusif(total, await getPajakSettings(supabase));
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Retur penjualan ${no_retur} (${sale!.no_struk ?? sale_id})`,
    source: "sales-return",
    sourceRef: no_retur,
    branchId: sale!.branch_id,
    lines: [
      { code: "4101", debit: dppRetur, credit: 0 },
      ...(ppnRetur > 0 ? [{ code: "2201", debit: ppnRetur, credit: 0 }] : []),
      { code: kasCode, debit: 0, credit: total },
    ],
  });
  // Jurnal HPP balik memakai modal yang sama dengan lapisan stok yang baru dibuat
  // di atas — buku dan stok fisik tidak boleh berbeda nilainya.
  //
  // Barang baik  → nilainya kembali ke Persediaan (1301).
  // Barang rusak → barangnya tidak kembali ke rak, jadi nilainya bukan persediaan
  //   melainkan kerugian (5902 Selisih Persediaan, akun yang sama dipakai koreksi
  //   opname). Dua-duanya tetap membalik HPP: beban pokok penjualan hanya boleh
  //   menempel pada barang yang benar-benar terjual dan tidak kembali.
  //
  // WAJIB satu postJournal saja: sejak migrasi 0106 ada unique index parsial pada
  // (source, source_ref) yang mencakup 'sales-return-hpp'. Dua kali posting dengan
  // source yang sama membuat yang kedua ditolak DB — dan postJournal menelan error,
  // jadi jurnalnya hilang tanpa jejak.
  const { baik: hppBaik, rusak: hppRusak, total: hppTotal } =
    pisahModalRetur(rows, modalSatuan, berstok);
  if (hppTotal > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `HPP retur penjualan ${no_retur}`,
      source: "sales-return-hpp",
      sourceRef: no_retur,
      branchId: sale!.branch_id,
      lines: [
        ...(hppBaik > 0 ? [{ code: "1301", debit: hppBaik, credit: 0 }] : []),
        ...(hppRusak > 0 ? [{ code: "5902", debit: hppRusak, credit: 0 }] : []),
        { code: "5101", debit: 0, credit: hppTotal },
      ],
    });
  }

  revalidatePath(listHref);
  redirect(`${listHref}?success=` + encodeURIComponent(`Retur ${no_retur} tersimpan.`));
}

// Formatnya dibaca dari master penomoran; bawaannya RJ.YYYY.MM.NNNNN.
async function nextNoRetur(supabase: Db) {
  const { nomor } = await nomorBerikutnya(supabase, "RJ", hariIniWIB(), {
    table: "sales_returns", column: "no_retur",
  });
  return nomor;
}

// Cari struk utk form (dipakai via query param, bukan action) — lihat baru/page.tsx.
