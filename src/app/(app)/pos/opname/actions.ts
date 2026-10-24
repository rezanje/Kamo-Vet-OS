"use server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { bolehBukaPath, type AturanTersimpan } from "@/lib/akses";
import { getOpenShift } from "@/lib/shift";
import { readCompleteList } from "@/lib/checked-list";

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
    try {
      const selectedMembers = await readCompleteList<{ id: string; family_id: string }>(
        (from, to) => supabase.from("item_variant_members")
          .select("id:item_id,family_id", { count: "exact" }).in("item_id", lingkup)
          .order("item_id").range(from, to), "Keluarga varian opname",
      );
      const familyIds = [...new Set(selectedMembers.map((row) => row.family_id))];
      if (familyIds.length) {
        type Member = { id: string; items: { item_type: string; is_active: boolean } | { item_type: string; is_active: boolean }[] | null };
        const members = await readCompleteList<Member>(
          (from, to) => supabase.from("item_variant_members")
            .select("id:item_id,items(item_type,is_active)", { count: "exact" }).in("family_id", familyIds)
            .order("item_id").range(from, to), "Anggota varian opname",
        );
        lingkup = [...new Set([...lingkup, ...members.filter((row) => {
          const item = Array.isArray(row.items) ? row.items[0] : row.items;
          return item?.item_type === "Persediaan" && item.is_active;
        }).map((row) => row.id)])];
      }
    } catch {
      fail("Gagal memuat daftar varian lengkap. Perintah opname belum dibuat; coba lagi.");
    }
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
      const { error: cancelError } = await supabase.rpc("cancel_opname_draft", { p_order_id: doc!.id, p_reason: "Pembuatan lingkup opname gagal; draf tidak dilanjutkan" });
      if (cancelError) fail(`Lingkup gagal dan pembatalan ${no_opname} belum terkonfirmasi. Jangan lanjutkan hitungan; periksa perintah asal dengan admin.`);
      fail("Gagal menyimpan lingkup barang opname.");
    }
  }

  revalidatePath("/pos/opname");
  revalidatePath("/kasir/opname");
  redirect(`${basis}/${doc!.id}?success=` + encodeURIComponent(`Perintah ${no_opname} tersimpan.`) + transactionDraftAck(formData));
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
  if (order.status !== "Terbuka") return { ok: false, pesan: order.status === "Batal" ? "Opname sudah dibatalkan." : "Hitungan ini sudah selesai." };

  if (!Number.isFinite(qtyFisik) || qtyFisik < 0) return { ok: false, pesan: "Isi jumlah fisik yang valid, minimal nol." };
  const qty = qtyFisik;
  const { data: { user } } = await supabase.auth.getUser();
  const { data: stok, error: stockError } = await supabase
    .from("stock").select("qty")
    .eq("warehouse_id", order.warehouse_id).eq("item_id", itemId).maybeSingle();

  if (stockError || (stok && !Number.isFinite(Number(stok.qty)))) return { ok: false, pesan: "Stok sistem belum dapat dipastikan. Muat ulang sebelum mengunci." };

  // Retry after a lost response must not overwrite the first lock snapshot.
  // Changing a confirmed count requires the existing explicit Buka action.
  const { error } = await supabase.from("opname_counts").upsert({
    order_id: orderId,
    item_id: itemId,
    qty_fisik: qty,
    qty_sistem: Number(stok?.qty ?? 0),
    locked_by: user?.id ?? null,
    locked_at: new Date().toISOString(),
  }, { onConflict: "order_id,item_id", ignoreDuplicates: true });
  if (error) return { ok: false, pesan: "Gagal menyimpan hitungan barang ini." };

  const { data: confirmed, error: confirmationError } = await supabase.from("opname_counts")
    .select("qty_fisik").eq("order_id", orderId).eq("item_id", itemId).maybeSingle();
  if (confirmationError || !confirmed || !Number.isFinite(Number(confirmed.qty_fisik)) || Number(confirmed.qty_fisik) < 0) {
    return { ok: false, pesan: "Kunci belum dapat dipastikan. Muat ulang; jangan anggap hitungan sudah tersimpan." };
  }
  revalidatePath(`/kasir/opname/${orderId}`);
  return { ok: true, qtyFisik: Number(confirmed.qty_fisik) };
}

/** Buka kunci: hitungan barang itu dibuang, petugas menghitung ulang. */
export async function bukaKunci(orderId: string, itemId: string) {
  const supabase = await createClient();
  const order = await orderTerjangkau(supabase, orderId);
  if (!order) return { ok: false, pesan: "Kamu tidak berhak menghitung stok gudang ini." };
  if (order.status !== "Terbuka") return { ok: false, pesan: order.status === "Batal" ? "Opname sudah dibatalkan." : "Hitungan ini sudah selesai." };

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
  const orderId = String(formData.get("order_id") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  const basis = basisKembali(formData);
  const back = `${basis}/${encodeURIComponent(orderId)}`;
  function fail(message: string): never { return redirect(`${back}?error=${encodeURIComponent(message)}`); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(orderId) || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail("Perintah atau tanggal opname tidak valid.");
  let counts: Record<string, number>;
  try {
    const parsed: unknown = JSON.parse(String(formData.get("fisik") ?? ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.entries(parsed).some(([id, qty]) => !uuid.test(id) || typeof qty !== "number" || !Number.isFinite(qty) || qty < 0)) fail("Hitungan fisik tidak valid. Periksa isian sebelum menyimpan.");
    counts = parsed as Record<string, number>;
  } catch { fail("Hitungan fisik tidak terbaca. Periksa isian sebelum menyimpan."); }
  const supabase = await createClient();
  let result;
  try {
    result = await supabase.rpc("post_opname_atomic", { p_order_id: orderId, p_tanggal: tanggal, p_counts: counts });
  } catch { fail("Posting opname belum dapat dipastikan. Muat ulang dan periksa hasil asal sebelum mencoba lagi."); }
  if (result.error) fail(result.error.code === "P0001" || result.error.code === "42501" ? result.error.message : "Posting opname belum dapat dipastikan. Muat ulang dan periksa hasil asal sebelum mencoba lagi.");
  const receipt = result.data as { result_id?: unknown; no_hasil?: unknown; tanggal?: unknown; no_faktur?: unknown; journal_ids?: unknown; already_posted?: unknown } | null;
  if (!receipt || typeof receipt.result_id !== "string" || !uuid.test(receipt.result_id) || typeof receipt.no_hasil !== "string" || !receipt.no_hasil.trim()
    || receipt.tanggal !== tanggal || typeof receipt.already_posted !== "boolean" || !Array.isArray(receipt.journal_ids) || receipt.journal_ids.some(id => typeof id !== "string" || !uuid.test(id))
    || (receipt.no_faktur !== null && typeof receipt.no_faktur !== "string")) fail("Posting opname belum dapat dipastikan. Muat ulang dan periksa hasil asal sebelum mencoba lagi.");
  for (const path of ["/pos/opname", "/kasir/opname", `/pos/opname/${orderId}`, `/kasir/opname/${orderId}`]) revalidatePath(path);
  const message = receipt.already_posted
    ? `Hasil ${receipt.no_hasil} sudah tersimpan. Tidak ada posting ulang.`
    : `Hasil ${receipt.no_hasil} tersimpan; stok dan ${receipt.journal_ids.length} jurnal terverifikasi.${receipt.no_faktur ? ` Selisih kurang ditagihkan lewat faktur ${receipt.no_faktur}.` : ""}`;
  redirect(`${back}?success=${encodeURIComponent(message)}` + transactionDraftAck(formData));
}

/** One guarded server transaction; no delete, reversal, stock or journal mutation. */
export async function batalPerintah(formData: FormData) {
  const basis = basisKembali(formData);
  const id = String(formData.get("order_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const back = id ? `${basis}/${encodeURIComponent(id)}` : basis;
  if (!id || reason.length < 3 || reason.length > 500) redirect(`${back}?error=${encodeURIComponent("Pilih perintah dan isi alasan pembatalan antara 3 dan 500 karakter.")}`);
  const supabase = await createClient();
  const result = await supabase.rpc("cancel_opname_draft", { p_order_id: id, p_reason: reason });
  if (result.error) {
    const message = result.error.code === "P0001" || result.error.code === "42501"
      ? result.error.message.replace(/^OPNAME_NOT_DRAFT:\s*/, "")
      : "Pembatalan belum dapat dipastikan. Muat ulang dan periksa status perintah sebelum mencoba lagi.";
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  for (const path of ["/pos/opname", "/kasir/opname", `/pos/opname/${id}`, `/kasir/opname/${id}`]) revalidatePath(path);
  redirect(`${back}?success=${encodeURIComponent("Perintah opname dibatalkan; riwayat tetap tersimpan.")}`);
}
