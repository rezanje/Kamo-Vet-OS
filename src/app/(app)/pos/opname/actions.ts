"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { barangKurang, nilaiFakturSelisih, pakaiHargaJual } from "@/lib/opname";
import { stockInAtBuyPrice, stockOut } from "@/lib/inventory";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { bolehBukaPath, type AturanTersimpan } from "@/lib/akses";
import { getOpenShift } from "@/lib/shift";
import { nextNoDokumen } from "@/lib/penjualan-server";
import { AKUN_HPP, AKUN_PERSEDIAAN, jurnalFakturJual } from "@/lib/penjualan-dokumen";

type Db = Awaited<ReturnType<typeof createClient>>;

const AKUN_SELISIH = "5902";

// Opname dibuka dari dua dunia: modul Persediaan (/pos/opname) dan layar kasir
// (/kasir/opname). Kasir tidak boleh dilempar ke halaman yang diblokir untuknya.
const basisKembali = (formData: FormData) =>
  String(formData.get("kembali") ?? "") === "kasir" ? "/kasir/opname" : "/pos/opname";

/**
 * Boleh menyentuh stok gudang ini?
 *
 * Petugas gudang lewat modul Persediaan; kasir lewat layar POS dan HANYA untuk
 * gudang cabang shift-nya sendiri. Tanpa cek ini satu POST dari layar kasir bisa
 * menyesuaikan stok cabang lain — layar boleh dibatasi, tapi yang menentukan
 * tetap server.
 */
async function bolehGudang(supabase: Db, warehouseId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const [{ data: profile }, { data: aturan }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("role_modules").select("role, module_id"),
  ]);
  const role = profile?.role ?? "";
  if (role && bolehBukaPath(role, "/pos/opname", (aturan ?? []) as AturanTersimpan)) return true;

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) return false;
  const { data: wh } = await supabase
    .from("warehouses").select("branch_id").eq("id", warehouseId).maybeSingle();
  return !!wh && wh.branch_id === shift.branch_id;
}

/** Perintah opname + gudangnya, sekaligus pagar hak akses. Null = tidak boleh. */
async function orderTerjangkau(supabase: Db, orderId: string) {
  const { data: order } = await supabase
    .from("opname_orders")
    .select("id, no_opname, status, warehouse_id")
    .eq("id", orderId).maybeSingle();
  if (!order) return null;
  if (!(await bolehGudang(supabase, order.warehouse_id as string))) return null;
  return order as { id: string; no_opname: string; status: string; warehouse_id: string };
}

// Seq global persis format Accurate (OPO.00385), dilanjutkan dari nomor tertinggi.
// Formatnya dibaca dari master penomoran; bawaannya tetap OPO./OPR. tanpa token tanggal,
// jadi nomornya berlanjut terus dan tidak mengulang tiap bulan.
async function nextNo(supabase: Db, table: "opname_orders" | "opname_results", prefix: "OPO" | "OPR") {
  const { nomor } = await nomorBerikutnya(supabase, prefix, hariIniWIB(), {
    table, column: table === "opname_orders" ? "no_opname" : "no_hasil",
  });
  return nomor;
}

// ================= Perintah Stok Opname =================
export async function buatPerintah(formData: FormData) {
  const supabase = await createClient();

  const warehouse_id = String(formData.get("warehouse_id") ?? "");
  const tanggal_mulai = String(formData.get("tanggal_mulai") ?? "") || hariIniWIB();
  const penanggung_jawab = String(formData.get("penanggung_jawab") ?? "").trim();
  const dikerjakan_oleh = String(formData.get("dikerjakan_oleh") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  const basis = basisKembali(formData);
  const fail = (msg: string) => redirect(`${basis}/baru?error=` + encodeURIComponent(msg));

  if (!warehouse_id || !penanggung_jawab) fail("Gudang dan penanggung jawab wajib diisi.");
  if (!(await bolehGudang(supabase, warehouse_id))) fail("Kamu tidak berhak menghitung stok gudang ini.");

  const { data: { user } } = await supabase.auth.getUser();

  // Opname parsial: daftar barang yang dihitung. Kosong = seluruh gudang, jadi
  // perintah lama (dan pilihan "Seluruh gudang") tetap berarti hitung penuh.
  let lingkup = String(formData.get("lingkup_items") ?? "")
    .split(",").map((x) => x.trim()).filter(Boolean);

  // Daftar otomatis (keputusan meeting): 20 barang terlaris + 10 acak. Barang cepat
  // laku paling rawan selisih; yang acak menangkap barang hilang yang tidak laku.
  if (String(formData.get("lingkup_mode") ?? "") === "auto") {
    const terlaris = Math.max(0, Number(formData.get("auto_terlaris")) || 20);
    const acak = Math.max(0, Number(formData.get("auto_acak")) || 10);
    const { data: auto, error: autoErr } = await supabase.rpc("opname_daftar_hitung", {
      p_warehouse: warehouse_id, p_top: terlaris, p_acak: acak,
    });
    if (autoErr) fail("Gagal menyusun daftar barang otomatis.");
    lingkup = ((auto ?? []) as { item_id: string }[]).map((r) => r.item_id);
    if (lingkup.length === 0) fail("Gudang ini belum punya barang ber-stok untuk dihitung.");
  }

  const no_opname = await nextNo(supabase, "opname_orders", "OPO");

  const { data: doc, error } = await supabase
    .from("opname_orders")
    .insert({ no_opname, warehouse_id, tanggal_mulai, penanggung_jawab, dikerjakan_oleh, keterangan, created_by: user?.id ?? null })
    .select("id").single();
  if (error || !doc) fail("Gagal menyimpan perintah opname.");

  if (lingkup.length > 0) {
    const { error: lErr } = await supabase.from("opname_order_items")
      .insert(lingkup.map((item_id) => ({ order_id: doc!.id, item_id })));
    if (lErr) {
      // Perintah tanpa lingkupnya berbahaya: layar hitung akan menampilkan SELURUH
      // gudang, padahal petugas cuma disuruh menghitung satu rak.
      await supabase.from("opname_orders").delete().eq("id", doc!.id);
      fail("Gagal menyimpan lingkup barang opname.");
    }
  }

  revalidatePath("/pos/opname");
  revalidatePath("/kasir/opname");
  redirect(`${basis}/${doc!.id}?success=` + encodeURIComponent(`Perintah ${no_opname} tersimpan.`));
}

// ================= Kunci hitungan per barang =================
// Angka yang sudah dihitung tidak boleh berubah gara-gara barangnya keburu terjual,
// dan tidak boleh hilang kalau layar tertutup atau mati lampu. Karena itu tiap
// barang dikunci satu per satu dan langsung tersimpan — bukan menunggu tombol akhir.

/** Kunci satu barang: simpan hitungan fisik + foto stok sistem saat itu. */
export async function kunciBaris(orderId: string, itemId: string, qtyFisik: number) {
  const supabase = await createClient();
  const order = await orderTerjangkau(supabase, orderId);
  if (!order) return { ok: false, pesan: "Kamu tidak berhak menghitung stok gudang ini." };
  if (order.status === "Selesai") return { ok: false, pesan: "Hitungan ini sudah selesai." };

  const qty = Math.max(0, Number(qtyFisik) || 0);
  const { data: { user } } = await supabase.auth.getUser();
  const { data: stok } = await supabase
    .from("stock").select("qty")
    .eq("warehouse_id", order.warehouse_id).eq("item_id", itemId).maybeSingle();

  const { error } = await supabase.from("opname_counts").upsert({
    order_id: orderId,
    item_id: itemId,
    qty_fisik: qty,
    qty_sistem: Number(stok?.qty ?? 0),
    locked_by: user?.id ?? null,
    locked_at: new Date().toISOString(),
  }, { onConflict: "order_id,item_id" });
  if (error) return { ok: false, pesan: "Gagal menyimpan hitungan barang ini." };

  revalidatePath(`/kasir/opname/${orderId}`);
  return { ok: true };
}

/** Buka kunci: hitungan barang itu dibuang, petugas menghitung ulang. */
export async function bukaKunci(orderId: string, itemId: string) {
  const supabase = await createClient();
  const order = await orderTerjangkau(supabase, orderId);
  if (!order) return { ok: false, pesan: "Kamu tidak berhak menghitung stok gudang ini." };
  if (order.status === "Selesai") return { ok: false, pesan: "Hitungan ini sudah selesai." };

  const { error } = await supabase.from("opname_counts")
    .delete().eq("order_id", orderId).eq("item_id", itemId);
  if (error) return { ok: false, pesan: "Gagal membuka kunci barang ini." };

  revalidatePath(`/kasir/opname/${orderId}`);
  return { ok: true };
}

/**
 * Muat ulang daftar & stok sistem tanpa menutup toko.
 *
 * Barang yang sudah dikunci TIDAK ikut berubah — fotonya diambil saat dikunci, itu
 * inti anti-selisih-palsu-nya. Yang diperbarui: barang baru yang masuk gudang
 * selama opname berjalan, dan angka sistem untuk barang yang belum dihitung.
 */
export async function muatUlangStok(orderId: string) {
  const supabase = await createClient();
  const order = await orderTerjangkau(supabase, orderId);
  if (!order) return { ok: false, pesan: "Kamu tidak berhak menghitung stok gudang ini." };
  revalidatePath(`/kasir/opname/${orderId}`);
  revalidatePath(`/pos/opname/${orderId}`);
  return { ok: true };
}

// ================= Hasil Stok Opname =================
/**
 * Simpan semua & sesuaikan stok.
 *
 * Yang diproses hanya barang yang punya hitungan (dikunci atau diisi lalu ditekan
 * simpan). Barang yang tidak dihitung sama sekali dilewat — menganggapnya nol akan
 * menghapus stok yang sebenarnya tidak pernah dihitung.
 *
 * Penyesuaian stok memakai SELISIH terhadap foto saat dikunci, bukan "set ke angka
 * fisik". Kalau barang laku setelah dihitung, penjualannya tidak ikut terhapus.
 */
export async function simpanHasil(formData: FormData) {
  const supabase = await createClient();

  const order_id = String(formData.get("order_id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();

  let fisik: Record<string, number> = {};
  try { fisik = JSON.parse(String(formData.get("fisik") ?? "{}")) as Record<string, number>; } catch { fisik = {}; }

  const basis = basisKembali(formData);
  const fail = (msg: string) => redirect(`${basis}/${order_id}?error=` + encodeURIComponent(msg));

  if (!order_id) fail("Perintah opname tidak dikenali.");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) fail(pesanPeriode);

  const { data: orderRaw } = await supabase
    .from("opname_orders")
    .select("id, no_opname, status, warehouse_id, warehouses(branch_id, type, branches(type))")
    .eq("id", order_id).single();
  if (!orderRaw) fail("Perintah opname tidak ditemukan.");
  const order = orderRaw as unknown as {
    id: string; no_opname: string; status: string; warehouse_id: string;
    warehouses: { branch_id: string; type: string; branches: { type: string } | null } | null;
  };
  if (order.status === "Selesai") fail("Perintah ini sudah selesai diopname.");
  if (!(await bolehGudang(supabase, order.warehouse_id))) fail("Kamu tidak berhak menghitung stok gudang ini.");

  // Lingkup ditegakkan di server juga: barang di luar perintah opname parsial tidak
  // boleh ikut disesuaikan, walaupun ikut terkirim dari layar yang sudah lama terbuka.
  const { data: lingkupRows } = await supabase
    .from("opname_order_items").select("item_id").eq("order_id", order_id);
  const lingkup = new Set((lingkupRows ?? []).map((r) => r.item_id as string));

  // Barang yang sudah dikunci: pakai angka + foto stok yang tersimpan saat dikunci.
  const { data: terkunci } = await supabase
    .from("opname_counts").select("item_id, qty_fisik, qty_sistem").eq("order_id", order_id);
  const kunciMap = new Map(
    ((terkunci ?? []) as { item_id: string; qty_fisik: number; qty_sistem: number }[])
      .map((r) => [r.item_id, { qty_fisik: Number(r.qty_fisik), qty_sistem: Number(r.qty_sistem) }]),
  );

  // Barang yang diisi tapi belum dikunci ikut disimpan — tombol "simpan semua" berarti
  // semua yang sudah dihitung, bukan hanya yang sempat ditekan kuncinya.
  const belumKunci = Object.keys(fisik)
    .filter((id) => !kunciMap.has(id) && (lingkup.size === 0 || lingkup.has(id)));

  if (belumKunci.length > 0) {
    const { data: stokBaru } = await supabase
      .from("stock").select("item_id, qty")
      .eq("warehouse_id", order.warehouse_id).in("item_id", belumKunci);
    const sistemMap = new Map((stokBaru ?? []).map((s) => [s.item_id as string, Number(s.qty)]));
    for (const id of belumKunci) {
      kunciMap.set(id, { qty_fisik: Math.max(0, Number(fisik[id]) || 0), qty_sistem: sistemMap.get(id) ?? 0 });
    }
  }

  const rows = [...kunciMap.entries()]
    .filter(([item_id]) => lingkup.size === 0 || lingkup.has(item_id))
    .map(([item_id, v]) => ({
      item_id,
      qty_sistem: v.qty_sistem,
      qty_fisik: v.qty_fisik,
      selisih: v.qty_fisik - v.qty_sistem,
    }));
  if (rows.length === 0) fail("Belum ada barang yang dihitung.");

  const itemIds = rows.map((r) => r.item_id);
  const { data: itemRows } = await supabase
    .from("items").select("id, name, unit, buy_price, sell_price").in("id", itemIds);
  type ItemRow = { id: string; name: string; unit: string | null; buy_price: number; sell_price: number };
  const itemMap = new Map(((itemRows ?? []) as ItemRow[]).map((r) => [r.id, r]));

  const { data: { user } } = await supabase.auth.getUser();
  const no_hasil = await nextNo(supabase, "opname_results", "OPR");

  const { data: doc, error } = await supabase
    .from("opname_results")
    .insert({ no_hasil, order_id, tanggal, created_by: user?.id ?? null })
    .select("id").single();
  if (error || !doc) fail("Gagal menyimpan hasil opname.");

  const { error: itemsErr } = await supabase.from("opname_result_items").insert(
    rows.map((r) => ({ result_id: doc!.id, ...r })),
  );
  if (itemsErr) {
    console.error("opname: gagal insert rincian", itemsErr);
    await supabase.from("opname_results").delete().eq("id", doc!.id);
    fail("Gagal menyimpan rincian hasil opname.");
  }

  // Sesuaikan stok via lib FIFO: lebih = layer baru @buy_price; kurang = konsumsi FIFO
  // (nilai kurang = cost layer RIIL, bukan buy_price statis).
  let kurangCost = 0;
  let lebih = 0;
  for (const r of rows) {
    if (r.selisih === 0) continue;
    if (r.selisih > 0) {
      await stockInAtBuyPrice(supabase, {
        warehouseId: order.warehouse_id, itemId: r.item_id, qty: r.selisih, source: "opname", ref: no_hasil,
      });
      lebih += r.selisih * Number(itemMap.get(r.item_id)?.buy_price ?? 0);
    } else {
      const { cost } = await stockOut(supabase, {
        warehouseId: order.warehouse_id, itemId: r.item_id, qty: -r.selisih, source: "opname", ref: no_hasil,
      });
      kurangCost += cost;
    }
  }

  const branchId = order.warehouses?.branch_id ?? null;
  const hargaJual = pakaiHargaJual({
    branchType: order.warehouses?.branches?.type ?? null,
    warehouseType: order.warehouses?.type ?? null,
  });

  // Barang lebih selalu dinilai modal — tidak ada yang menagih siapa pun untuk
  // barang yang justru ketemu.
  if (lebih > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Selisih lebih stok opname ${no_hasil} (${order.no_opname})`,
      source: "opname",
      sourceRef: no_hasil,
      branchId,
      lines: [
        { code: AKUN_PERSEDIAAN, debit: lebih, credit: 0 },
        { code: AKUN_SELISIH, debit: 0, credit: lebih },
      ],
    });
  }

  const kurang = barangKurang(rows);
  let noFaktur: string | null = null;

  if (kurang.length > 0 && hargaJual) {
    // Petshop: barang hilang ditanggung kepala toko, jadi dikonversi jadi faktur
    // penjualan harga jual normal (tanpa promo) dan ditagih lewat piutang.
    // Modalnya tetap keluar dari persediaan seperti penjualan biasa.
    const nilai = Math.round(nilaiFakturSelisih(
      kurang, new Map(kurang.map((k) => [k.item_id, Number(itemMap.get(k.item_id)?.sell_price ?? 0)])),
    ));

    if (kurangCost > 0) {
      await postJournal(supabase, {
        tanggal,
        deskripsi: `HPP selisih stok opname ${no_hasil} (${order.no_opname})`,
        source: "opname",
        sourceRef: no_hasil,
        branchId,
        lines: [
          { code: AKUN_HPP, debit: kurangCost, credit: 0 },
          { code: AKUN_PERSEDIAAN, debit: 0, credit: kurangCost },
        ],
      });
    }

    if (nilai > 0) {
      noFaktur = await nextNoDokumen(supabase, "FJS");
      const { data: inv } = await supabase.from("sales_invoices").insert({
        no_faktur: noFaktur,
        branch_id: branchId,
        tanggal,
        kategori: "selisih_stok",
        dpp: nilai,
        ppn: 0,
        total: nilai,
        catatan: `Selisih kurang stok opname ${no_hasil} (${order.no_opname}) — ditanggung kepala toko.`,
        created_by: user?.id ?? null,
      }).select("id").single();

      if (inv) {
        await supabase.from("sales_invoice_items").insert(kurang.map((k) => {
          const it = itemMap.get(k.item_id);
          return {
            invoice_id: inv.id,
            item_id: k.item_id,
            nama: it?.name ?? "Barang",
            satuan: it?.unit ?? null,
            qty: k.qty,
            harga: Number(it?.sell_price ?? 0),
          };
        }));
        await supabase.from("opname_results").update({ invoice_id: inv.id }).eq("id", doc!.id);

        await postJournal(supabase, {
          tanggal,
          deskripsi: `Faktur selisih stok ${noFaktur} (${no_hasil})`,
          source: "opname-selisih",
          sourceRef: noFaktur,
          branchId,
          lines: jurnalFakturJual(nilai, 0),
        });
      }
    }
  } else if (kurangCost > 0) {
    // Klinik: banyak obat harga jualnya nol karena cuma bahan racikan, jadi selisih
    // tetap dinilai modal dan masuk beban selisih persediaan.
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Selisih kurang stok opname ${no_hasil} (${order.no_opname})`,
      source: "opname",
      sourceRef: no_hasil,
      branchId,
      lines: [
        { code: AKUN_SELISIH, debit: kurangCost, credit: 0 },
        { code: AKUN_PERSEDIAAN, debit: 0, credit: kurangCost },
      ],
    });
  }

  await supabase.from("opname_orders").update({ status: "Selesai" }).eq("id", order_id);

  revalidatePath("/pos/opname");
  revalidatePath("/kasir/opname");
  const pesan = noFaktur
    ? `Hasil ${no_hasil} tersimpan. Selisih kurang ditagihkan lewat faktur ${noFaktur}.`
    : `Hasil ${no_hasil} tersimpan, stok disesuaikan.`;
  redirect(`${basis}/${order_id}?success=` + encodeURIComponent(pesan));
}
