"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { formatNoOpname } from "@/lib/opname";
import { stockInAtBuyPrice, stockOut } from "@/lib/inventory";
import { urutanBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { bolehBukaPath, type AturanTersimpan } from "@/lib/akses";
import { getOpenShift } from "@/lib/shift";

type Db = Awaited<ReturnType<typeof createClient>>;

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

// Seq global persis format Accurate (OPO.00385), dilanjutkan dari nomor tertinggi.
async function nextNo(supabase: Db, table: "opname_orders" | "opname_results", prefix: "OPO" | "OPR") {
  const seq = await urutanBerikutnya(supabase, {
    table, column: table === "opname_orders" ? "no_opname" : "no_hasil",
    prefix: `${prefix}.`, pad: 5,
  });
  return formatNoOpname(prefix, seq);
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
  const no_opname = await nextNo(supabase, "opname_orders", "OPO");

  // Opname parsial: daftar barang yang dihitung. Kosong = seluruh gudang, jadi
  // perintah lama (dan pilihan "Seluruh gudang") tetap berarti hitung penuh.
  const lingkup = String(formData.get("lingkup_items") ?? "")
    .split(",").map((x) => x.trim()).filter(Boolean);

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

// ================= Hasil Stok Opname =================
// Stok di-set ke qty fisik; selisih dijurnal (Dr/Cr 1301 vs 5902) pakai buy_price.
export async function simpanHasil(formData: FormData) {
  const supabase = await createClient();

  const order_id = String(formData.get("order_id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();

  let fisik: Record<string, number> = {};
  try { fisik = JSON.parse(String(formData.get("fisik") ?? "{}")) as Record<string, number>; } catch { fisik = {}; }

  const basis = basisKembali(formData);
  const fail = (msg: string) => redirect(`${basis}/${order_id}?error=` + encodeURIComponent(msg));

  if (!order_id || Object.keys(fisik).length === 0) fail("Tidak ada data hitungan fisik.");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) fail(pesanPeriode);

  const { data: order } = await supabase
    .from("opname_orders")
    .select("id, no_opname, status, warehouse_id, warehouses(branch_id)")
    .eq("id", order_id).single();
  if (!order) fail("Perintah opname tidak ditemukan.");
  if (order!.status === "Selesai") fail("Perintah ini sudah selesai diopname.");
  if (!(await bolehGudang(supabase, order!.warehouse_id))) fail("Kamu tidak berhak menghitung stok gudang ini.");

  // Lingkup ditegakkan di server juga: barang di luar perintah opname parsial tidak
  // boleh ikut disesuaikan, walaupun ikut terkirim dari layar yang sudah lama terbuka.
  const { data: lingkupRows } = await supabase
    .from("opname_order_items").select("item_id").eq("order_id", order_id);
  const lingkup = new Set((lingkupRows ?? []).map((r) => r.item_id as string));

  // qty sistem dibaca ULANG saat submit (race-safe), bukan snapshot form.
  const itemIds = Object.keys(fisik).filter((id) => lingkup.size === 0 || lingkup.has(id));
  if (itemIds.length === 0) fail("Tidak ada barang dalam lingkup opname ini.");
  const [{ data: stocks }, { data: itemRows }] = await Promise.all([
    supabase.from("stock").select("item_id, qty").eq("warehouse_id", order!.warehouse_id).in("item_id", itemIds),
    supabase.from("items").select("id, buy_price").in("id", itemIds),
  ]);
  const sistemMap = new Map((stocks ?? []).map((s) => [s.item_id as string, Number(s.qty)]));
  const hargaMap = new Map((itemRows ?? []).map((r) => [r.id as string, Number(r.buy_price) || 0]));

  const rows = itemIds.map((item_id) => {
    const qty_sistem = sistemMap.get(item_id) ?? 0;
    const qty_fisik = Math.max(0, Number(fisik[item_id]) || 0);
    return { item_id, qty_sistem, qty_fisik, selisih: qty_fisik - qty_sistem };
  });

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

  // sesuaikan stok via lib FIFO: lebih = layer baru @buy_price; kurang = konsumsi FIFO
  // (nilai jurnal kurang = cost layer RIIL, bukan buy_price statis).
  let kurang = 0;
  let lebih = 0;
  for (const r of rows) {
    if (r.selisih === 0) continue;
    if (r.selisih > 0) {
      await stockInAtBuyPrice(supabase, {
        warehouseId: order!.warehouse_id, itemId: r.item_id, qty: r.selisih, source: "opname", ref: no_hasil,
      });
      lebih += r.selisih * (hargaMap.get(r.item_id) ?? 0);
    } else {
      const { cost } = await stockOut(supabase, {
        warehouseId: order!.warehouse_id, itemId: r.item_id, qty: -r.selisih, source: "opname", ref: no_hasil,
      });
      kurang += cost;
    }
  }
  const wh = order!.warehouses as unknown as { branch_id: string } | null;
  if (lebih > 0 || kurang > 0) {
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Penyesuaian stok opname ${no_hasil} (${order!.no_opname})`,
      source: "opname",
      sourceRef: no_hasil,
      branchId: wh?.branch_id ?? null,
      lines: [
        ...(lebih > 0 ? [
          { code: "1301", debit: lebih, credit: 0 },
          { code: "5902", debit: 0, credit: lebih },
        ] : []),
        ...(kurang > 0 ? [
          { code: "5902", debit: kurang, credit: 0 },
          { code: "1301", debit: 0, credit: kurang },
        ] : []),
      ],
    });
  }

  await supabase.from("opname_orders").update({ status: "Selesai" }).eq("id", order_id);

  revalidatePath("/pos/opname");
  revalidatePath("/kasir/opname");
  redirect(`${basis}/${order_id}?success=` + encodeURIComponent(`Hasil ${no_hasil} tersimpan, stok disesuaikan.`));
}
