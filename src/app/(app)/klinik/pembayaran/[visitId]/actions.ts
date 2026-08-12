"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar, kodeBawaan, kodeKasJurnalAsal } from "@/lib/kas-akun";
import { getPajakSettings, tambahPpn } from "@/lib/pajak";
import { getOpenShift } from "@/lib/shift";
import { diffInvoice, requiresReason, type InvoiceSnapshot } from "@/lib/invoice-diff";
import { bolehBayar, kategoriBerisiko } from "@/lib/tindakan";
import { recomputeCustomerTier } from "@/lib/customer-tier";
import { stockIn, stockOut } from "@/lib/inventory";
import { formatNomor, urutanBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { bacaRombongan } from "@/lib/rombongan-server";

type Line = { deskripsi: string; qty: number; harga: number; jenis?: string; item_id?: string | null };

// Obat klinik memotong stok gudang cabang & mencatat modalnya, sama seperti
// penjualan di kasir. Sebelum migrasi 0084 ini tidak bisa dilakukan: baris
// tagihan cuma menyimpan NAMA obat, jadi sistem tidak tahu barang mana.
//
// Jasa dan baris ketikan bebas (tanpa item_id) dilewati — memang tidak punya stok.
async function potongStokObat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  branchId: string | null,
  baris: { item_id?: string | null; qty: number }[],
  ref: string,
): Promise<{ hppPerBaris: Map<string, number>; totalHpp: number }> {
  const hppPerBaris = new Map<string, number>();
  let totalHpp = 0;
  const obat = baris.filter((l) => l.item_id && Number(l.qty) > 0);
  if (!branchId || obat.length === 0) return { hppPerBaris, totalHpp };

  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", branchId).eq("is_active", true)
    .order("type").limit(1).maybeSingle();
  if (!wh) return { hppPerBaris, totalHpp };

  for (const l of obat) {
    try {
      const { cost } = await stockOut(supabase, {
        warehouseId: wh.id, itemId: l.item_id!, qty: Number(l.qty), source: "klinik", ref,
      });
      hppPerBaris.set(l.item_id!, (hppPerBaris.get(l.item_id!) ?? 0) + cost);
      totalHpp += cost;
    } catch (e) {
      // Invoice sudah tersimpan — jangan bikin kasir crash di depan pasien.
      // ponytail: dicatat ke log; kalau ini kejadian beneran, naikkan jadi
      // notifikasi backoffice + antrean koreksi stok.
      console.error(`[stok klinik] gagal potong stok ${ref} item ${l.item_id}:`, e);
    }
  }
  return { hppPerBaris, totalHpp };
}

// Kebalikan potongStokObat: kembalikan obat baris invoice LAMA ke gudang saat invoice
// diedit. Modalnya diambil dari hpp yang tercatat di barisnya, bukan dari harga beli
// master — kalau tidak, tiap edit menambah/mengurangi nilai persediaan dari udara.
// Mengembalikan total HPP lama supaya jurnalnya bisa dibalik dengan angka yang sama.
async function kembalikanStokObat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  branchId: string | null,
  baris: { item_id?: string | null; qty: number; hpp?: number | null }[],
  ref: string,
): Promise<number> {
  const obat = baris.filter((l) => l.item_id && Number(l.qty) > 0 && Number(l.hpp) > 0);
  if (!branchId || obat.length === 0) return 0;

  const { data: wh } = await supabase
    .from("warehouses").select("id").eq("branch_id", branchId).eq("is_active", true)
    .order("type").limit(1).maybeSingle();
  if (!wh) return 0;

  let total = 0;
  for (const l of obat) {
    const qty = Number(l.qty);
    const hpp = Number(l.hpp);
    try {
      await stockIn(supabase, {
        warehouseId: wh.id, itemId: l.item_id!, qty,
        unitCost: hpp / qty, source: "klinik-edit", ref,
      });
      total += hpp;
    } catch (e) {
      console.error(`[stok klinik] gagal kembalikan stok ${ref} item ${l.item_id}:`, e);
    }
  }
  return total;
}

// Baris jurnal invoice klinik (dipakai posting normal + pembalikan saat edit/void).
// kasCode diserahkan pemanggil: posting baru memakai peta rekening, pembalikan memakai
// akun yang dipakai jurnal aslinya.
function invoiceJournalLines(inv: { total: number; dpp: number; tax: number; dp_amount: number; paid_status: string }, kasCode: string, reverse = false) {
  const cashReceived = inv.paid_status === "Lunas" ? inv.total : inv.paid_status === "DP" ? inv.dp_amount : 0;
  const piutang = Math.max(0, inv.total - cashReceived);
  const lines = [
    ...(cashReceived > 0 ? [{ code: kasCode, debit: cashReceived, credit: 0 }] : []),
    ...(piutang > 0 ? [{ code: "1201", debit: piutang, credit: 0 }] : []),
    { code: "4201", debit: 0, credit: inv.dpp },
    ...(inv.tax > 0 ? [{ code: "2201", debit: 0, credit: inv.tax }] : []),
  ];
  return reverse ? lines.map((l) => ({ code: l.code, debit: l.credit, credit: l.debit })) : lines;
}

const todayIso = () => hariIniWIB();

async function nextInvoiceNo(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  // Nomor dilanjutkan dari yang tertinggi; race antar kasir masih dijaga unique constraint.
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-`;
  const seq = await urutanBerikutnya(supabase, {
    table: "invoices", column: "invoice_no", prefix, pad: 4,
  });
  return formatNomor(prefix, seq, 4);
}

export async function bayarVisit(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  const back = `/klinik/pembayaran/${visitId}`;

  // Addendum §1: transaksi wajib terikat shift klinik yang open (validasi server, bukan UI).
  const { data: { user: payUser } } = await supabase.auth.getUser();
  const klinikShift = payUser ? await getOpenShift(supabase as never, payUser.id, "klinik") : null;
  if (!klinikShift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses pembayaran")}`);

  // §6.3: tindakan berisiko tidak boleh ditagih sebelum pemilik menandatangani form
  // persetujuan. Dicek server-side — UI menyembunyikan tombol, tapi itu bukan pengaman.
  {
    const { data: mrGate } = await supabase
      .from("medical_records").select("id").eq("visit_id", visitId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const [{ data: jasaRows }, { data: inpatRow }, { data: consentRows }] = await Promise.all([
      mrGate
        ? supabase.from("prescription_items").select("jenis, kategori").eq("medical_record_id", mrGate.id)
        : Promise.resolve({ data: [] as { jenis: string; kategori: string | null }[] }),
      supabase.from("inpatient_records").select("id").eq("visit_id", visitId).limit(1).maybeSingle(),
      supabase.from("consents").select("status").eq("visit_id", visitId),
    ]);
    const boleh = bolehBayar(
      (jasaRows ?? []) as { jenis: string; kategori: string | null }[],
      !!inpatRow,
      (consentRows ?? []) as { status: string }[],
    );
    if (!boleh) {
      const kat = kategoriBerisiko((jasaRows ?? []) as { jenis: string; kategori: string | null }[], !!inpatRow);
      redirect(`${back}?error=${encodeURIComponent(`Form persetujuan untuk tindakan ${kat.join(", ")} belum ditandatangani`)}`);
    }
  }

  let items: Line[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    items = [];
  }
  const rows = items
    .filter((l) => l.deskripsi?.trim())
    .map((l) => ({
      deskripsi: l.deskripsi.trim(), qty: Number(l.qty) > 0 ? Number(l.qty) : 1,
      harga: Number(l.harga) || 0, jenis: l.jenis === "jasa" ? "jasa" : "obat",
      // Jasa tidak punya stok — item_id-nya sengaja dibuang di sini supaya
      // tidak ada yang mencoba memotong stoknya.
      item_id: l.jenis === "jasa" ? null : (l.item_id ?? null),
    }));

  if (rows.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Minimal 1 item tagihan")}`);
  }

  // Invoice + potong stok obat + jurnal harus jalan bareng. Periode terkunci =
  // obat keluar gudang tapi pendapatannya tidak pernah masuk buku besar.
  const pesanPeriode = await cekPeriode(supabase, todayIso());
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);

  const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);
  const discount = Number(formData.get("discount")) || 0;
  const dpp = Math.max(0, subtotal - discount);
  // PPN hanya ditambahkan bila Mode PKP aktif (pengaturan/pajak); OFF → tax 0.
  const { tax, total } = tambahPpn(dpp, await getPajakSettings(supabase));

  // "Bayar & Selesai" memaksa lunas; "Simpan" pakai status turunan dari jumlah bayar.
  const finalize = String(formData.get("finalize") ?? "") === "1";
  const paidStatus = finalize ? "Lunas" : String(formData.get("paid_status") ?? "Belum Lunas");
  const metode = String(formData.get("metode_bayar") ?? "Tunai");
  const dpAmount = paidStatus === "DP" ? Number(formData.get("dp_amount")) || 0 : 0;
  const dpDate = paidStatus === "DP" ? String(formData.get("dp_date") ?? "") || null : null;
  const paidAt = paidStatus === "Lunas" ? new Date().toISOString() : null;
  const reason = String(formData.get("edit_reason") ?? "").trim() || null;
  // Visit ditutup hanya saat lunas; DP/Belum Lunas tetap tahap Pembayaran (bisa dilanjut).
  const visitStatus = paidStatus === "Lunas" ? "Selesai" : "Pembayaran";

  // Invoice aktif (belum di-void) untuk visit ini — kalau ada, ini jalur EDIT (Addendum §7).
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, invoice_no, subtotal, discount, tax, total, dp_amount, paid_status, metode_bayar")
    .eq("visit_id", visitId).is("voided_at", null).maybeSingle();

  const { data: v } = await supabase.from("visits").select("branch_id, customer_id").eq("id", visitId).maybeSingle();

  if (existing) {
    // §7: invoice Lunas tidak boleh diedit langsung — wajib Void & Reissue.
    if (existing.paid_status === "Lunas") {
      redirect(`${back}?error=${encodeURIComponent("Invoice lunas tidak boleh diedit — gunakan Void & Terbitkan Ulang")}`);
    }
    // Invoice yang sudah menerima pelunasan piutang juga tidak boleh diedit langsung —
    // jurnal pelunasannya tidak ikut ter-reverse oleh jalur edit.
    const { count: payCount } = await supabase
      .from("invoice_payments").select("*", { count: "exact", head: true }).eq("invoice_id", existing.id);
    if ((payCount ?? 0) > 0) {
      redirect(`${back}?error=${encodeURIComponent("Invoice sudah menerima pelunasan piutang — gunakan Void & Terbitkan Ulang")}`);
    }

    // item_id & hpp ikut dibaca: baris obat yang diganti harus dikembalikan stoknya
    // dengan modal yang persis sama seperti saat keluar.
    const { data: oldItems } = await supabase
      .from("invoice_items").select("deskripsi, qty, harga, item_id, hpp").eq("invoice_id", existing.id).order("created_at");

    const oldSnap: InvoiceSnapshot = {
      subtotal: Number(existing.subtotal), discount: Number(existing.discount), tax: Number(existing.tax),
      total: Number(existing.total), paid_status: existing.paid_status, metode_bayar: existing.metode_bayar,
      items: (oldItems ?? []).map((i) => ({ deskripsi: i.deskripsi, qty: Number(i.qty), harga: Number(i.harga) })),
    };
    const newSnap: InvoiceSnapshot = { subtotal, discount, tax, total, paid_status: paidStatus, metode_bayar: metode, items: rows };
    const diffs = diffInvoice(oldSnap, newSnap);

    if (diffs.length === 0) {
      redirect(`${back}?success=bayar`);
    }
    if (requiresReason(diffs) && !reason) {
      redirect(`${back}?error=${encodeURIComponent("Isi alasan perubahan — nominal/item invoice berubah (audit wajib)")}`);
    }

    // server yang men-generate log — block silent overwrite (spec §7).
    const { error: logErr } = await supabase.from("invoice_edit_log").insert(
      diffs.map((d) => ({ invoice_id: existing.id, edited_by: payUser?.id ?? null, ...d, reason })),
    );
    if (logErr) redirect(`${back}?error=${encodeURIComponent("Gagal tulis audit log: " + logErr.message)}`);

    // shift_id SENGAJA tidak ikut diubah. Invoice milik shift yang MENERBITKANNYA;
    // memindahkannya ke shift yang sedang mengedit membuat uang mukanya dihitung dua
    // kali — sekali saat shift asal ditutup, sekali lagi di shift yang baru.
    const { error: upErr } = await supabase
      .from("invoices")
      .update({ subtotal, discount, tax, total, dp_amount: dpAmount, dp_date: dpDate, paid_status: paidStatus, metode_bayar: metode, paid_at: paidAt })
      .eq("id", existing.id);
    if (upErr) redirect(`${back}?error=${encodeURIComponent(upErr.message)}`);

    // Stok obat ikut disinkronkan. Tanpa ini, mengganti/menghapus baris obat pada
    // invoice yang sudah terbit membuat persediaan dan HPP salah PERMANEN: obat lama
    // sudah keluar dari gudang dan tidak pernah kembali, obat baru tidak pernah keluar.
    const hppLama = await kembalikanStokObat(supabase, v?.branch_id ?? null, oldItems ?? [], existing.invoice_no);
    const { hppPerBaris: hppBaru, totalHpp: hppTotalBaru } =
      await potongStokObat(supabase, v?.branch_id ?? null, rows, existing.invoice_no);

    await supabase.from("invoice_items").delete().eq("invoice_id", existing.id);
    const { error: itErr } = await supabase
      .from("invoice_items")
      // item_id & hpp sebelumnya hilang di jalur edit — baris hasil edit jadi tidak
      // terhubung ke barang, sehingga retur/laporan modal tidak bisa menilainya.
      .insert(rows.map((l) => ({
        invoice_id: existing.id, deskripsi: l.deskripsi, qty: l.qty, harga: l.harga, jenis: l.jenis,
        item_id: l.item_id, hpp: l.item_id ? (hppBaru.get(l.item_id) ?? 0) : null,
      })));
    if (itErr) redirect(`${back}?error=${encodeURIComponent(itErr.message)}`);

    // §7 edge case: buku besar wajib re-sync — balikkan jurnal lama, posting ulang yang baru.
    const oldDpp = Math.max(0, Number(existing.subtotal) - Number(existing.discount));
    const kasLama = await kodeKasJurnalAsal(
      supabase, "klinik", existing.invoice_no,
      await kodeAkunBayar(supabase, existing.metode_bayar, v?.branch_id ?? null),
    );
    const kasBaru = await kodeAkunBayar(supabase, metode, v?.branch_id ?? null);
    await postJournal(supabase, {
      tanggal: todayIso(), deskripsi: `Pembalikan edit invoice ${existing.invoice_no}`, source: "klinik-edit",
      sourceRef: existing.invoice_no, branchId: v?.branch_id ?? null,
      lines: invoiceJournalLines({ total: Number(existing.total), dpp: oldDpp, tax: Number(existing.tax), dp_amount: Number(existing.dp_amount), paid_status: existing.paid_status }, kasLama, true),
    });
    await postJournal(supabase, {
      tanggal: todayIso(), deskripsi: `Posting ulang invoice ${existing.invoice_no} (edit)`, source: "klinik-edit",
      sourceRef: existing.invoice_no, branchId: v?.branch_id ?? null,
      lines: invoiceJournalLines({ total, dpp, tax, dp_amount: dpAmount, paid_status: paidStatus }, kasBaru),
    });

    // Jurnal HPP juga wajib ikut re-sync — kalau hanya pendapatannya yang dibalik,
    // beban pokok obat lama tetap menempel di Laba Rugi selamanya.
    if (hppLama > 0) {
      await postJournal(supabase, {
        tanggal: todayIso(), deskripsi: `Pembalikan HPP obat ${existing.invoice_no} (edit)`,
        source: "klinik-hpp-edit", sourceRef: existing.invoice_no, branchId: v?.branch_id ?? null,
        lines: [{ code: "1301", debit: hppLama, credit: 0 }, { code: "5101", debit: 0, credit: hppLama }],
      });
    }
    if (hppTotalBaru > 0) {
      await postJournal(supabase, {
        tanggal: todayIso(), deskripsi: `HPP obat ${existing.invoice_no} (edit)`,
        source: "klinik-hpp-edit", sourceRef: existing.invoice_no, branchId: v?.branch_id ?? null,
        lines: [{ code: "5101", debit: hppTotalBaru, credit: 0 }, { code: "1301", debit: 0, credit: hppTotalBaru }],
      });
    }

    await supabase.from("visits").update({ status: visitStatus }).eq("id", visitId);
    if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
    redirect(`${back}?success=edit`);
  }

  // ---- jalur CREATE (invoice pertama utk visit ini) ----
  const invoiceNo = await nextInvoiceNo(supabase);

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({ visit_id: visitId, invoice_no: invoiceNo, subtotal, discount, tax, total, dp_amount: dpAmount, dp_date: dpDate, paid_status: paidStatus, metode_bayar: metode, paid_at: paidAt, shift_id: klinikShift.id })
    .select("id").single();
  if (invErr || !inv) {
    redirect(`${back}?error=${encodeURIComponent(invErr?.message ?? "Gagal simpan invoice")}`);
  }

  // Stok obat dipotong di sini, bukan saat resep ditulis: dokter bisa mengubah
  // resep sampai detik terakhir, dan barang baru benar-benar keluar saat ditebus.
  const { hppPerBaris, totalHpp } = await potongStokObat(supabase, v?.branch_id ?? null, rows, invoiceNo);

  const { error: itErr } = await supabase
    .from("invoice_items")
    .insert(rows.map((l) => ({
      invoice_id: inv!.id, deskripsi: l.deskripsi, qty: l.qty, harga: l.harga, jenis: l.jenis,
      item_id: l.item_id, hpp: l.item_id ? (hppPerBaris.get(l.item_id) ?? 0) : null,
    })));
  if (itErr) {
    redirect(`${back}?error=${encodeURIComponent(itErr.message)}`);
  }

  await supabase.from("visits").update({ status: visitStatus }).eq("id", visitId);

  // Accounting (akrual): pendapatan jasa klinik diakui saat invoice; PPN dipisah.
  await postJournal(supabase, {
    tanggal: todayIso(),
    deskripsi: `Pendapatan jasa klinik ${invoiceNo}`,
    source: "klinik",
    sourceRef: invoiceNo,
    branchId: v?.branch_id ?? null,
    lines: invoiceJournalLines(
      { total, dpp, tax, dp_amount: dpAmount, paid_status: paidStatus },
      await kodeAkunBayar(supabase, metode, v?.branch_id ?? null),
    ),
  });

  // Beban pokok obat yang ditebus. Tanpa ini seluruh tagihan klinik terlihat
  // sebagai laba murni — obatnya seolah didapat gratis.
  if (totalHpp > 0) {
    await postJournal(supabase, {
      tanggal: todayIso(),
      deskripsi: `HPP obat klinik ${invoiceNo}`,
      source: "klinik-hpp",
      sourceRef: invoiceNo,
      branchId: v?.branch_id ?? null,
      lines: [
        { code: "5101", debit: totalHpp, credit: 0 },
        { code: "1301", debit: 0, credit: totalHpp },
      ],
    });
  }

  if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
  // tetap di halaman pembayaran (read-only) supaya tombol Struk/Invoice langsung terlihat.
  redirect(`/klinik/pembayaran/${visitId}?success=bayar`);
}

/**
 * Baris tagihan sebuah kunjungan, diambil dari resep/tindakan yang diinput dokter.
 * Sama dengan prefill di layar pembayaran; kalau dokter tidak menginput apa pun,
 * jatuh ke jasa konsultasi poli supaya kunjungan tidak ditagih Rp 0 diam-diam.
 */
async function barisTagihanVisit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  visitId: string,
  poli: string,
): Promise<Line[]> {
  const { data: mr } = await supabase
    .from("medical_records").select("id").eq("visit_id", visitId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: resep } = mr
    ? await supabase.from("prescription_items")
        .select("nama_obat, qty, harga, jenis, item_id").eq("medical_record_id", mr.id).order("created_at")
    : { data: [] as { nama_obat: string; qty: number; harga: number; jenis: string; item_id: string | null }[] };

  const rows = (resep ?? []).map((r) => ({
    deskripsi: String(r.nama_obat ?? "").trim(),
    qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
    harga: Number(r.harga) || 0,
    jenis: r.jenis === "jasa" ? "jasa" : "obat",
    item_id: r.jenis === "jasa" ? null : (r.item_id ?? null),
  })).filter((l) => l.deskripsi);

  return rows.length ? rows : [{ deskripsi: `Jasa Konsultasi ${poli}`, qty: 1, harga: 0, jenis: "jasa", item_id: null }];
}

/**
 * Bayar sekaligus seluruh kunjungan satu pemilik pada hari itu (satu kedatangan,
 * beberapa hewan). Pemilik cukup membayar sekali; catatannya tetap terpisah per
 * hewan supaya rekam medis, insentif dokter, dan pembukuan tidak tercampur.
 *
 * Yang diproses hanya kunjungan yang tagihannya BELUM dibuat. Kunjungan yang sudah
 * punya invoice (DP, sebagian dibayar, atau perlu diedit) sengaja dilewati dan
 * dilaporkan — jalur pelunasannya punya jurnal sendiri dan tidak boleh ditebak
 * dari layar ini.
 */
export async function bayarRombongan(formData: FormData) {
  const supabase = await createClient();

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  const back = `/klinik/pembayaran/${visitId}`;
  const metode = String(formData.get("metode_bayar") ?? "Tunai");

  const { data: { user } } = await supabase.auth.getUser();
  const klinikShift = user ? await getOpenShift(supabase as never, user.id, "klinik") : null;
  if (!klinikShift) redirect(`/klinik/shift?error=${encodeURIComponent("Mulai shift klinik dulu sebelum memproses pembayaran")}`);

  const rombongan = await bacaRombongan(supabase, visitId);
  const belum = (rombongan?.baris ?? []).filter((b) => b.invoiceNo === null);
  if (!rombongan || rombongan.baris.length < 2) {
    redirect(`${back}?error=${encodeURIComponent("Pemilik ini hanya punya satu kunjungan hari ini")}`);
  }
  if (belum.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Semua tagihan sudah dibuat — selesaikan lewat masing-masing kunjungan")}`);
  }

  const pajakSettings = await getPajakSettings(supabase);
  const dilewati: string[] = [];
  let jumlahLunas = 0;

  for (const b of belum) {
    const { data: v } = await supabase
      .from("visits").select("branch_id, customer_id, poli").eq("id", b.visitId).maybeSingle();
    if (!v) { dilewati.push(b.hewan); continue; }

    // §6.3: tindakan berisiko wajib punya persetujuan bertanda tangan. Berlaku per
    // hewan — satu hewan yang belum menandatangani tidak boleh ikut terbayar diam-diam.
    const { data: mrGate } = await supabase
      .from("medical_records").select("id").eq("visit_id", b.visitId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const [{ data: jasaRows }, { data: inpatRow }, { data: consentRows }] = await Promise.all([
      mrGate
        ? supabase.from("prescription_items").select("jenis, kategori").eq("medical_record_id", mrGate.id)
        : Promise.resolve({ data: [] as { jenis: string; kategori: string | null }[] }),
      supabase.from("inpatient_records").select("id").eq("visit_id", b.visitId).limit(1).maybeSingle(),
      supabase.from("consents").select("status").eq("visit_id", b.visitId),
    ]);
    if (!bolehBayar(
      (jasaRows ?? []) as { jenis: string; kategori: string | null }[],
      !!inpatRow,
      (consentRows ?? []) as { status: string }[],
    )) {
      dilewati.push(b.hewan);
      continue;
    }

    const rows = await barisTagihanVisit(supabase, b.visitId, String(v.poli ?? "Poli Umum"));
    const subtotal = rows.reduce((a, l) => a + l.qty * l.harga, 0);
    const { tax, total } = tambahPpn(subtotal, pajakSettings);

    const invoiceNo = await nextInvoiceNo(supabase);
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert({
        visit_id: b.visitId, invoice_no: invoiceNo, subtotal, discount: 0, tax, total,
        dp_amount: 0, dp_date: null, paid_status: "Lunas", metode_bayar: metode,
        paid_at: new Date().toISOString(), shift_id: klinikShift.id,
      })
      .select("id").single();
    if (invErr || !inv) {
      // Hewan yang gagal tidak menggagalkan yang lain — sisanya tetap terbayar,
      // yang ini dilaporkan supaya kasir menyelesaikannya satu per satu.
      dilewati.push(b.hewan);
      continue;
    }

    const { hppPerBaris, totalHpp } = await potongStokObat(supabase, v.branch_id ?? null, rows, invoiceNo);
    await supabase.from("invoice_items").insert(rows.map((l) => ({
      invoice_id: inv.id, deskripsi: l.deskripsi, qty: l.qty, harga: l.harga, jenis: l.jenis,
      item_id: l.item_id, hpp: l.item_id ? (hppPerBaris.get(l.item_id) ?? 0) : null,
    })));

    await supabase.from("visits").update({ status: "Selesai" }).eq("id", b.visitId);

    // Rekening kas mengikuti peta metode bayar CABANG kunjungan itu — bukan bawaan
    // global; uang tunai cabang A tidak boleh mendarat di rekening cabang B.
    await postJournal(supabase, {
      tanggal: todayIso(), deskripsi: `Pendapatan jasa klinik ${invoiceNo}`, source: "klinik",
      sourceRef: invoiceNo, branchId: v.branch_id ?? null,
      lines: invoiceJournalLines(
        { total, dpp: subtotal, tax, dp_amount: 0, paid_status: "Lunas" },
        await kodeAkunBayar(supabase, metode, v.branch_id ?? null),
      ),
    });
    if (totalHpp > 0) {
      await postJournal(supabase, {
        tanggal: todayIso(), deskripsi: `HPP obat klinik ${invoiceNo}`, source: "klinik-hpp",
        sourceRef: invoiceNo, branchId: v.branch_id ?? null,
        lines: [{ code: "5101", debit: totalHpp, credit: 0 }, { code: "1301", debit: 0, credit: totalHpp }],
      });
    }
    jumlahLunas++;
  }

  if (rombongan.customerId) await recomputeCustomerTier(supabase, rombongan.customerId);

  if (jumlahLunas === 0) {
    redirect(`${back}?error=${encodeURIComponent(`Tidak ada tagihan yang bisa diselesaikan sekaligus (${dilewati.join(", ")}) — buka satu per satu`)}`);
  }
  const sisa = dilewati.length ? `&dilewati=${encodeURIComponent(dilewati.join(", "))}` : "";
  redirect(`${back}?success=rombongan&lunas=${jumlahLunas}${sisa}`);
}

// Addendum §7: invoice Lunas → Void & Reissue (standar akuntansi, bukan edit diam-diam).
export async function voidAndReissue(formData: FormData) {
  const supabase = await createClient();
  const visitId = String(formData.get("visitId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!visitId) redirect(`/klinik/antrian?error=${encodeURIComponent("Visit tidak valid")}`);
  const back = `/klinik/pembayaran/${visitId}`;
  if (!reason) redirect(`${back}?error=${encodeURIComponent("Isi alasan void — wajib untuk audit")}`);

  const { data: { user } } = await supabase.auth.getUser();

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, invoice_no, subtotal, discount, tax, total, dp_amount, dp_date, paid_status, metode_bayar, shift_id")
    .eq("visit_id", visitId).is("voided_at", null).maybeSingle();
  if (!inv) redirect(`${back}?error=${encodeURIComponent("Invoice aktif tidak ditemukan")}`);
  // Boleh void: invoice lunas, ATAU invoice yang sudah menerima pelunasan piutang
  // (edit langsung diblokir untuk keduanya — jurnalnya harus di-reverse lewat sini).
  const { data: invPays } = await supabase
    .from("invoice_payments").select("tanggal, amount, metode, kas_code").eq("invoice_id", inv!.id);
  if (inv!.paid_status !== "Lunas" && (invPays ?? []).length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Void & Reissue hanya untuk invoice lunas / sudah ada pelunasan — edit langsung saja")}`);
  }

  const { data: items } = await supabase
    .from("invoice_items").select("deskripsi, qty, harga, jenis, item_id, hpp").eq("invoice_id", inv!.id).order("created_at");

  // 1) void invoice lama + log.
  const { error: voidErr } = await supabase
    .from("invoices").update({ voided_at: new Date().toISOString() }).eq("id", inv!.id);
  if (voidErr) redirect(`${back}?error=${encodeURIComponent(voidErr.message)}`);

  // 2) balikkan jurnal invoice lama (buku besar tetap sinkron — §7 edge case).
  const dpp = Math.max(0, Number(inv!.subtotal) - Number(inv!.discount));
  const { data: v } = await supabase.from("visits").select("branch_id, customer_id").eq("id", visitId).maybeSingle();
  await postJournal(supabase, {
    tanggal: todayIso(), deskripsi: `Void invoice ${inv!.invoice_no}`, source: "klinik-void",
    sourceRef: inv!.invoice_no, branchId: v?.branch_id ?? null,
    lines: invoiceJournalLines(
      { total: Number(inv!.total), dpp, tax: Number(inv!.tax), dp_amount: Number(inv!.dp_amount), paid_status: inv!.paid_status },
      await kodeKasJurnalAsal(
        supabase, "klinik", inv!.invoice_no,
        await kodeAkunBayar(supabase, inv!.metode_bayar, v?.branch_id ?? null),
      ),
      true,
    ),
  });

  // 2b) invoice belum-lunas dengan pelunasan parsial: jurnal pelunasannya (Dr kas / Cr piutang)
  // tidak tercakup reversal di atas — balikkan satu per satu. (Kalau Lunas, reversal
  // berbentuk-Lunas di atas sudah menetralkan kas & piutang sekaligus.)
  if (inv!.paid_status !== "Lunas") {
    for (const p of invPays ?? []) {
      // Rekening pelunasan bisa dipilih manual di layar piutang, jadi metode saja tidak
      // cukup untuk menebaknya — pakai yang tercatat, bawaan hanya untuk data lama.
      const kasCode = (p as { kas_code?: string | null }).kas_code || kodeBawaan(p.metode);
      await postJournal(supabase, {
        tanggal: todayIso(), deskripsi: `Void pelunasan piutang ${inv!.invoice_no}`, source: "klinik-void",
        sourceRef: inv!.invoice_no, branchId: v?.branch_id ?? null,
        lines: [
          { code: "1201", debit: Number(p.amount), credit: 0 },
          { code: kasCode, debit: 0, credit: Number(p.amount) },
        ],
      });
    }
  }

  // 3) terbitkan invoice baru (Belum Lunas) dgn item yang sama, reference ke yang lama.
  const newNo = await nextInvoiceNo(supabase);
  const { data: newInv, error: newErr } = await supabase
    .from("invoices")
    .insert({
      visit_id: visitId, invoice_no: newNo, subtotal: inv!.subtotal, discount: inv!.discount, tax: inv!.tax,
      total: inv!.total, dp_amount: 0, dp_date: null, paid_status: "Belum Lunas", metode_bayar: inv!.metode_bayar,
      paid_at: null, reissued_from: inv!.id, shift_id: inv!.shift_id,
    })
    .select("id").single();
  if (newErr || !newInv) redirect(`${back}?error=${encodeURIComponent(newErr?.message ?? "Gagal terbitkan ulang")}`);

  // Barangnya tidak keluar ulang dari gudang (obat sudah terlanjur ditebus), jadi
  // item_id & hpp diwariskan apa adanya — bukan di-nol-kan seperti sebelumnya, yang
  // membuat invoice hasil terbit-ulang tidak bisa diretur atau dinilai modalnya.
  await supabase.from("invoice_items").insert(
    (items ?? []).map((l) => ({
      invoice_id: newInv!.id, deskripsi: l.deskripsi, qty: l.qty, harga: l.harga, jenis: l.jenis,
      item_id: l.item_id, hpp: l.hpp,
    })),
  );

  await supabase.from("invoice_edit_log").insert({
    invoice_id: inv!.id, edited_by: user?.id ?? null, field_changed: "voided",
    old_value: inv!.invoice_no, new_value: newNo, reason,
  });

  // invoice baru belum dibayar → visit balik ke tahap Pembayaran.
  await supabase.from("visits").update({ status: "Pembayaran" }).eq("id", visitId);

  if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
  redirect(`${back}?success=reissue`);
}
