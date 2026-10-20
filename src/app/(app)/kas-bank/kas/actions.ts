"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { cekPeriode, jurnalTersimpan } from "@/lib/jurnal-guard";
import { akunLawanTerlarang, hrefKas, jurnalKasEntry, validasiKasEntry, type JenisKas } from "@/lib/kas-entry";
import { parseLampiran } from "@/lib/dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { postJournal } from "@/lib/posting";
import { cekPersetujuan } from "@/lib/persetujuan-server";
import { kunciKasKeluar } from "@/lib/persetujuan";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { assertDraftJournal, transactionDraftAck } from "@/lib/transaction-draft-ack";

const BOLEH = ["OWNER", "ADMIN", "FINANCE"];

const bacaJenis = (formData: FormData): JenisKas =>
  String(formData.get("jenis") ?? "") === "Masuk" ? "Masuk" : "Keluar";

type Rekening = { id: string; nama: string; coa_code: string; is_active: boolean };

export async function simpanKasEntry(formData: FormData) {
  const jenis = bacaJenis(formData);
  const BACK = hrefKas(jenis);
  const gagal: (msg: string) => never = (msg) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const supabase = await assertRole(BACK, "kas masuk/keluar", BOLEH);

  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const accountId = String(formData.get("account_id") ?? "").trim();
  const lawanCode = String(formData.get("lawan_code") ?? "").trim();
  const jumlah = Number(formData.get("jumlah"));
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  const salah = validasiKasEntry({ jenis, tanggal, accountId, lawanCode, jumlah, hariIni: hariIniWIB() });
  if (salah) gagal(salah);

  // Kas keluar = uang keluar tanpa faktur; tanpa bukti tidak bisa diaudit sama
  // sekali. Kas masuk buktinya opsional (setoran internal sering tanpa nota).
  const lampiran = parseLampiran(formData.get("lampiran"));
  if (jenis === "Keluar" && lampiran.length === 0) {
    gagal("Lampiran bukti wajib diisi untuk kas keluar");
  }

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  // Kode akun diambil dari master, bukan dari form — form cuma mengirim id.
  const { data: rekData } = await supabase
    .from("cash_accounts").select("id, nama, coa_code, is_active").eq("id", accountId);
  const rek = ((rekData ?? []) as Rekening[])[0];
  if (!rek) gagal("Rekening tidak ditemukan");
  if (!rek.is_active) gagal("Rekening yang dipilih sudah nonaktif");

  // Rekening kas/bank tidak boleh jadi akun lawan — itu transfer, bukan kas masuk/keluar.
  const { data: semuaRek } = await supabase.from("cash_accounts").select("coa_code");
  const terlarang = akunLawanTerlarang(((semuaRek ?? []) as { coa_code: string }[]).map((r) => r.coa_code));
  if (terlarang.has(lawanCode)) {
    gagal("Akun lawan tidak boleh rekening kas/bank — pakai menu Transfer Bank.");
  }

  // Formatnya dibaca dari master penomoran. Awalannya sudah memisahkan Masuk (KM)
  // dari Keluar (KK), jadi tidak perlu saringan jenis lagi saat mencari nomor tertinggi.
  const { nomor: noBukti } = await nomorBerikutnya(
    supabase, jenis === "Masuk" ? "KM" : "KK", tanggal,
    { table: "cash_entries", column: "no_bukti" },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Hanya kas KELUAR yang dijaga: uang masuk tidak perlu izin siapa pun.
  // Diperiksa sebelum bukti kas terbit, jadi transaksi yang ditahan tidak
  // meninggalkan nomor bukti kosong yang harus dijelaskan belakangan.
  if (jenis === "Keluar") {
    const izin = await cekPersetujuan(supabase, {
      jenis: "kas-keluar",
      refId: kunciKasKeluar({ tanggal, accountId, lawanCode, jumlah }),
      nilai: jumlah,
      noDokumen: null,
      keterangan: `Kas keluar ${rek.nama} Rp ${Math.round(jumlah).toLocaleString("id-ID")}${keterangan ? ` — ${keterangan}` : ""}`,
      userId: user?.id ?? null,
    });
    if (!izin.boleh) gagal(izin.pesan ?? "Pengeluaran ini butuh persetujuan atasan.");
  }

  const { data: entry, error: entryErr } = await supabase.from("cash_entries").insert({
    no_bukti: noBukti, jenis, tanggal,
    account_id: accountId, lawan_code: lawanCode, jumlah,
    branch_id: branchId, keterangan, created_by: user?.id ?? null,
  }).select("id").maybeSingle();

  if (entryErr || !entry) {
    gagal(entryErr?.message.includes("cash_entries_no_bukti_key")
      ? "Nomor bukti bentrok, coba simpan sekali lagi"
      : "Gagal menyimpan, coba lagi");
  }

  if (lampiran.length > 0) {
    const { error: attachmentError } = await supabase.from("document_attachments").insert(
      lampiran.map((l) => ({ ...l, modul: "pengeluaran", ref_id: entry!.id, uploaded_by: user?.id ?? null })),
    );
    if (attachmentError) {
      await supabase.from("cash_entries").delete().eq("id", entry!.id);
      gagal("Bukti gagal disimpan. Periksa daftar kas sebelum mencoba lagi.");
    }
  }

  await postJournal(supabase, {
    tanggal,
    deskripsi: `Kas ${jenis} ${rek.nama} (${noBukti})${keterangan ? ` — ${keterangan}` : ""}`,
    source: "kas-entry",
    sourceRef: noBukti,
    branchId,
    lines: jurnalKasEntry(jenis, rek.coa_code, lawanCode, jumlah),
  });

  // Uang berpindah di layar tapi tidak di pembukuan = lebih buruk daripada gagal.
  if (!(await jurnalTersimpan(supabase, "kas-entry", noBukti))) {
    await supabase.from("cash_entries").delete().eq("id", entry!.id);
    gagal("Jurnal gagal tersimpan, transaksi dibatalkan — coba lagi");
  }

  try {
    await assertDraftJournal(supabase, { source: "kas-entry", sourceRef: noBukti, tanggal, branchId,
      lines: jurnalKasEntry(jenis, rek.coa_code, lawanCode, jumlah) });
  } catch {
    gagal("Jurnal kas belum terkonfirmasi lengkap. Periksa transaksi sebelum menyimpan ulang.");
  }
  redirect(`${BACK}?success=1` + transactionDraftAck(formData));
}

export async function batalkanKasEntry(formData: FormData) {
  const jenis = bacaJenis(formData);
  const BACK = hrefKas(jenis);
  const gagal: (msg: string) => never = (msg) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

  const supabase = await assertRole(BACK, "kas masuk/keluar", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Transaksi tidak valid");
  const { data: entry } = await supabase.from("cash_entries").select("revision").eq("id", id).maybeSingle();
  if (!entry) gagal("Transaksi tidak ditemukan");
  const { data: result, error } = await supabase.rpc("revise_cash_entry", {
    p_request_key: String(formData.get("draft_key") ?? formData.get("requestKey") ?? ""), p_cash_entry_id: id,
    p_expected_revision: Number(formData.get("revision") ?? entry.revision ?? 0), p_action: "void", p_header: {},
    p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error || !result?.reversal_journal_id) gagal(error?.message ?? "Pembatalan kas belum terkonfirmasi");
  redirect(`${BACK}?success=batal` + transactionDraftAck(formData));
}

export async function koreksiKasEntry(formData: FormData) {
  const jenis = bacaJenis(formData); const BACK = hrefKas(jenis);
  const supabase = await assertRole(BACK, "kas masuk/keluar", ["OWNER"]);
  let header: Record<string, string | number>;
  try { header = { tanggal: String(formData.get("tanggal") ?? ""), account_id: String(formData.get("account_id") ?? ""), lawan_code: String(formData.get("lawan_code") ?? ""), jumlah: Number(formData.get("jumlah")), keterangan: String(formData.get("keterangan") ?? "") }; } catch { redirect(`${BACK}?error=Data koreksi tidak valid`); }
  const { data: result, error } = await supabase.rpc("revise_cash_entry", {
    p_request_key: String(formData.get("draft_key") ?? formData.get("requestKey") ?? ""), p_cash_entry_id: String(formData.get("id") ?? ""),
    p_expected_revision: Number(formData.get("revision") ?? 0), p_action: "edit", p_header: header!,
    p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error || !result?.reversal_journal_id || !result?.replacement_journal_id) redirect(`${BACK}?error=${encodeURIComponent(error?.message ?? "Koreksi kas belum terkonfirmasi")}`);
  redirect(`${BACK}?success=edit` + transactionDraftAck(formData));
}
