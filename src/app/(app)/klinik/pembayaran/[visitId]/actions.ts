"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { getPajakSettings, tambahPpn } from "@/lib/pajak";
import { getOpenShift } from "@/lib/shift";
import { diffInvoice, requiresReason, type InvoiceSnapshot } from "@/lib/invoice-diff";
import { bolehBayar, kategoriBerisiko } from "@/lib/tindakan";
import { recomputeCustomerTier } from "@/lib/customer-tier";

type Line = { deskripsi: string; qty: number; harga: number; jenis?: string };

// Baris jurnal invoice klinik (dipakai posting normal + pembalikan saat edit/void).
function invoiceJournalLines(inv: { total: number; dpp: number; tax: number; dp_amount: number; paid_status: string; metode_bayar: string }, reverse = false) {
  const kasCode = inv.metode_bayar === "Tunai" ? "1101" : "1102";
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

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

async function nextInvoiceNo(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  // ponytail: count+1 bisa race di concurrency tinggi; unique constraint jadi backstop.
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { count } = await supabase
    .from("invoices").select("*", { count: "exact", head: true }).like("invoice_no", `${prefix}-%`);
  return `${prefix}-${String((count ?? 0) + 1).padStart(4, "0")}`;
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
    .map((l) => ({ deskripsi: l.deskripsi.trim(), qty: Number(l.qty) > 0 ? Number(l.qty) : 1, harga: Number(l.harga) || 0, jenis: l.jenis === "jasa" ? "jasa" : "obat" }));

  if (rows.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Minimal 1 item tagihan")}`);
  }

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

    const { data: oldItems } = await supabase
      .from("invoice_items").select("deskripsi, qty, harga").eq("invoice_id", existing.id).order("created_at");

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

    const { error: upErr } = await supabase
      .from("invoices")
      .update({ subtotal, discount, tax, total, dp_amount: dpAmount, dp_date: dpDate, paid_status: paidStatus, metode_bayar: metode, paid_at: paidAt, shift_id: klinikShift.id })
      .eq("id", existing.id);
    if (upErr) redirect(`${back}?error=${encodeURIComponent(upErr.message)}`);

    await supabase.from("invoice_items").delete().eq("invoice_id", existing.id);
    const { error: itErr } = await supabase
      .from("invoice_items")
      .insert(rows.map((l) => ({ invoice_id: existing.id, deskripsi: l.deskripsi, qty: l.qty, harga: l.harga, jenis: l.jenis })));
    if (itErr) redirect(`${back}?error=${encodeURIComponent(itErr.message)}`);

    // §7 edge case: buku besar wajib re-sync — balikkan jurnal lama, posting ulang yang baru.
    const oldDpp = Math.max(0, Number(existing.subtotal) - Number(existing.discount));
    await postJournal(supabase, {
      tanggal: todayIso(), deskripsi: `Pembalikan edit invoice ${existing.invoice_no}`, source: "klinik-edit",
      sourceRef: existing.invoice_no, branchId: v?.branch_id ?? null,
      lines: invoiceJournalLines({ total: Number(existing.total), dpp: oldDpp, tax: Number(existing.tax), dp_amount: Number(existing.dp_amount), paid_status: existing.paid_status, metode_bayar: existing.metode_bayar }, true),
    });
    await postJournal(supabase, {
      tanggal: todayIso(), deskripsi: `Posting ulang invoice ${existing.invoice_no} (edit)`, source: "klinik-edit",
      sourceRef: existing.invoice_no, branchId: v?.branch_id ?? null,
      lines: invoiceJournalLines({ total, dpp, tax, dp_amount: dpAmount, paid_status: paidStatus, metode_bayar: metode }),
    });

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

  const { error: itErr } = await supabase
    .from("invoice_items")
    .insert(rows.map((l) => ({ invoice_id: inv!.id, deskripsi: l.deskripsi, qty: l.qty, harga: l.harga, jenis: l.jenis })));
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
    lines: invoiceJournalLines({ total, dpp, tax, dp_amount: dpAmount, paid_status: paidStatus, metode_bayar: metode }),
  });

  if (v?.customer_id) await recomputeCustomerTier(supabase, v.customer_id);
  // tetap di halaman pembayaran (read-only) supaya tombol Struk/Invoice langsung terlihat.
  redirect(`/klinik/pembayaran/${visitId}?success=bayar`);
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
    .from("invoice_payments").select("tanggal, amount, metode").eq("invoice_id", inv!.id);
  if (inv!.paid_status !== "Lunas" && (invPays ?? []).length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Void & Reissue hanya untuk invoice lunas / sudah ada pelunasan — edit langsung saja")}`);
  }

  const { data: items } = await supabase
    .from("invoice_items").select("deskripsi, qty, harga, jenis").eq("invoice_id", inv!.id).order("created_at");

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
    lines: invoiceJournalLines({ total: Number(inv!.total), dpp, tax: Number(inv!.tax), dp_amount: Number(inv!.dp_amount), paid_status: inv!.paid_status, metode_bayar: inv!.metode_bayar }, true),
  });

  // 2b) invoice belum-lunas dengan pelunasan parsial: jurnal pelunasannya (Dr kas / Cr piutang)
  // tidak tercakup reversal di atas — balikkan satu per satu. (Kalau Lunas, reversal
  // berbentuk-Lunas di atas sudah menetralkan kas & piutang sekaligus.)
  if (inv!.paid_status !== "Lunas") {
    for (const p of invPays ?? []) {
      const kasCode = p.metode === "Tunai" ? "1101" : "1102";
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

  await supabase.from("invoice_items").insert(
    (items ?? []).map((l) => ({ invoice_id: newInv!.id, deskripsi: l.deskripsi, qty: l.qty, harga: l.harga, jenis: l.jenis })),
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
