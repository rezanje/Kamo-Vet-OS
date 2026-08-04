"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { cekPeriode, jurnalTersimpan } from "@/lib/jurnal-guard";
import { validasiTransfer, jurnalTransfer, jurnalBalik, nomorTransfer } from "@/lib/transfer-kas";
import { hariIniWIB } from "@/lib/followup";
import { postJournal } from "@/lib/posting";
import { prefixBulanan, urutanBerikutnya } from "@/lib/no-dokumen";

const BACK = "/kas-bank/transfer";
const BOLEH = ["OWNER", "ADMIN", "FINANCE"];
// Tipe ditulis di variabelnya (bukan cuma di arrow) supaya TypeScript memakai
// `never` untuk mempersempit tipe sesudah pemanggilan — tanpa itu, setiap
// pemakaian di bawah guard masih dianggap mungkin null.
const gagal: (msg: string) => never = (msg) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

type Rekening = { id: string; nama: string; coa_code: string; is_active: boolean };

export async function buatTransfer(formData: FormData) {
  const supabase = await assertRole(BACK, "transfer bank", BOLEH);

  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const dariId = String(formData.get("from_account_id") ?? "").trim();
  const keId = String(formData.get("to_account_id") ?? "").trim();
  const jumlah = Number(formData.get("jumlah"));
  const biayaAdmin = Number(formData.get("biaya_admin")) || 0;
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  const salah = validasiTransfer({ tanggal, dariId, keId, jumlah, biayaAdmin, hariIni: hariIniWIB() });
  if (salah) gagal(salah);

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // Kode akun diambil dari master, bukan dari form — form cuma mengirim id.
  const { data: rekData } = await supabase
    .from("cash_accounts").select("id, nama, coa_code, is_active").in("id", [dariId, keId]);
  const rek = (rekData ?? []) as Rekening[];
  const dari = rek.find((r) => r.id === dariId);
  const ke = rek.find((r) => r.id === keId);
  if (!dari || !ke) gagal("Rekening tidak ditemukan");
  if (!dari!.is_active || !ke!.is_active) gagal("Rekening yang dipilih sudah nonaktif");

  // Nomor per bulan (pola IT/RB/RJ/FB), dilanjutkan dari nomor tertinggi bulan itu.
  const seq = await urutanBerikutnya(supabase, {
    table: "cash_transfers", column: "no_transfer",
    prefix: prefixBulanan("TF", tanggal.slice(0, 7)), pad: 5,
  });
  const noTransfer = nomorTransfer(tanggal, seq - 1);

  const { data: { user } } = await supabase.auth.getUser();

  const { data: trf, error: trfErr } = await supabase.from("cash_transfers").insert({
    no_transfer: noTransfer, tanggal,
    from_account_id: dariId, to_account_id: keId,
    jumlah, biaya_admin: biayaAdmin, branch_id: branchId, keterangan,
    created_by: user?.id ?? null,
  }).select("id").maybeSingle();

  if (trfErr || !trf) {
    gagal(trfErr?.message.includes("cash_transfers_no_transfer_key")
      ? "Nomor transfer bentrok, coba simpan sekali lagi"
      : "Gagal menyimpan transfer, coba lagi");
  }

  await postJournal(supabase, {
    tanggal,
    deskripsi: `Transfer ${dari!.nama} → ${ke!.nama} (${noTransfer})`,
    source: "transfer",
    sourceRef: noTransfer,
    branchId,
    lines: jurnalTransfer(dari!.coa_code, ke!.coa_code, jumlah, biayaAdmin),
  });

  // Transfer tanpa jurnal = uang pindah di layar tapi tidak di pembukuan.
  if (!(await jurnalTersimpan(supabase, "transfer", noTransfer))) {
    await supabase.from("cash_transfers").delete().eq("id", trf!.id);
    gagal("Jurnal gagal tersimpan, transfer dibatalkan — coba lagi");
  }

  redirect(`${BACK}?success=1`);
}

export async function batalkanTransfer(formData: FormData) {
  const supabase = await assertRole(BACK, "transfer bank", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Transfer tidak valid");

  const { data: trf } = await supabase
    .from("cash_transfers")
    .select("id, no_transfer, tanggal, jumlah, biaya_admin, branch_id, voided_at, from_account_id, to_account_id")
    .eq("id", id).maybeSingle();
  if (!trf) gagal("Transfer tidak ditemukan");
  if (trf.voided_at) gagal("Transfer ini sudah dibatalkan");

  // Jurnal balik bertanggal SAMA dengan transfer asli — kalau dilempar ke hari ini,
  // laporan dua bulan (bulan asal & bulan pembatalan) sama-sama jadi salah.
  const pesanPeriode = await cekPeriode(supabase, trf.tanggal as string);
  if (pesanPeriode) gagal(pesanPeriode);

  const { data: rekData } = await supabase
    .from("cash_accounts").select("id, nama, coa_code, is_active")
    .in("id", [trf.from_account_id as string, trf.to_account_id as string]);
  const rek = (rekData ?? []) as Rekening[];
  const dari = rek.find((r) => r.id === trf.from_account_id);
  const ke = rek.find((r) => r.id === trf.to_account_id);
  if (!dari || !ke) gagal("Rekening transfer ini tidak ditemukan");

  // Predikat voided_at ada di UPDATE-nya sendiri (bukan cuma di pembacaan di atas)
  // supaya klik dobel tidak menghasilkan dua jurnal balik.
  const { data: updated } = await supabase
    .from("cash_transfers").update({ voided_at: new Date().toISOString() })
    .eq("id", id).is("voided_at", null).select("id");
  if (!updated || updated.length === 0) gagal("Transfer ini sudah dibatalkan");

  await postJournal(supabase, {
    tanggal: trf.tanggal as string,
    deskripsi: `Pembatalan transfer ${trf.no_transfer}`,
    source: "transfer-void",
    sourceRef: trf.no_transfer as string,
    branchId: (trf.branch_id as string | null) ?? null,
    lines: jurnalBalik(jurnalTransfer(dari!.coa_code, ke!.coa_code, Number(trf.jumlah), Number(trf.biaya_admin))),
  });

  if (!(await jurnalTersimpan(supabase, "transfer-void", trf.no_transfer as string))) {
    await supabase.from("cash_transfers").update({ voided_at: null }).eq("id", id);
    gagal("Jurnal pembatalan gagal tersimpan, pembatalan dibatalkan — coba lagi");
  }

  redirect(`${BACK}?success=batal`);
}
