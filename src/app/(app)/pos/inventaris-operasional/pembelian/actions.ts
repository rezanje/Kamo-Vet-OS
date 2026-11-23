"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseLampiran } from "@/lib/dokumen";
import { INVOP_PATH, isUuid, kunciPersetujuanPembelian, parseQty, pesanGagal } from "@/lib/inventaris-operasional";
import { cekPersetujuan } from "@/lib/persetujuan-server";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";

const PATH = `${INVOP_PATH}/pembelian`;
const KEY = /^[A-Za-z0-9-]{8,160}$/;
const kembali = (branch: string, params: Record<string, string>) =>
  `${PATH}?${new URLSearchParams(isUuid(branch) ? { cabang: branch, ...params } : params).toString()}`;

/**
 * Catat pembelian: SATU panggilan database menulis Kas Keluar + jurnal + nota + jumlah barang + riwayat, atau tidak
 * sama sekali. Kunci permintaan sama (klik ganda / kirim ulang setelah koneksi putus) mengembalikan hasil pertama.
 */
export async function catatPembelian(formData: FormData) {
  const branch = String(formData.get("branch_id") ?? "");
  const key = String(formData.get("request_key") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  const nama = String(formData.get("nama_baru") ?? "").trim().replace(/\s+/g, " ");
  const satuan = String(formData.get("satuan_baru") ?? "").trim().replace(/\s+/g, " ");
  const qty = parseQty(formData.get("qty"));
  const nominal = parseQty(formData.get("nominal"));
  const accountId = String(formData.get("account_id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim();
  const lampiran = parseLampiran(formData.get("lampiran"));
  const gagal = (pesan: string): never => redirect(kembali(branch, { error: pesan }));

  if (!isUuid(branch) || !KEY.test(key)) gagal("Formulir tidak lengkap. Muat ulang halaman.");
  const item = itemId === "baru" ? { nama, satuan } : isUuid(itemId) ? { id: itemId } : null;
  if (!item) gagal("Pilih barang atau isi barang baru.");
  if (itemId === "baru" && (nama.length < 2 || nama.length > 120 || satuan.length < 1 || satuan.length > 30)) gagal("Barang baru: nama 2–120 huruf dan satuan wajib diisi.");
  if (qty === null || qty <= 0) gagal("Jumlah barang harus lebih dari 0 (maks. 2 desimal).");
  if (nominal === null || nominal <= 0) gagal("Nominal total harus lebih dari 0 (maks. 2 desimal).");
  if (!isUuid(accountId)) gagal("Pilih kas/bank sumber.");
  if (catatan.length > 500) gagal("Catatan maksimal 500 huruf.");
  if (lampiran.length < 1 || lampiran.length > 10) gagal("Lampiran nota wajib diunggah (1–10 berkas).");

  const supabase = await createClient();
  const simpan = () => supabase.rpc("inventaris_operasional_beli", {
    p_request_key: key, p_branch: branch, p_item: item, p_qty: qty, p_nominal: nominal, p_account_id: accountId,
    p_catatan: catatan || null, p_attachments: lampiran,
  });

  // Database memeriksa transaksi yang sudah tersimpan sebelum aturan persetujuan.
  // Kiriman ulang tetap memakai hasil lama walau persetujuan sudah terpakai.
  let { data, error } = await simpan();
  if (error?.message.startsWith("INVENTARIS_PERLU_PERSETUJUAN:")) {
    const { data: setelan, error: setelanError } = await supabase
      .from("operational_inventory_settings").select("beban_code").maybeSingle();
    if (setelanError || !setelan?.beban_code) gagal("Akun beban pembelian inventaris belum dapat dibaca. Coba lagi.");
    const { data: { user } } = await supabase.auth.getUser();
    const izin = await cekPersetujuan(supabase, {
      jenis: "kas-keluar",
      refId: kunciPersetujuanPembelian({ tanggal: hariIniWIB(), accountId, bebanCode: String(setelan!.beban_code), nominal: nominal! }),
      nilai: nominal!,
      noDokumen: null,
      keterangan: `Pembelian Inventaris Operasional Rp ${Math.round(nominal!).toLocaleString("id-ID")}`,
      userId: user?.id ?? null,
      deferConsumption: true,
    });
    if (!izin.boleh) gagal(izin.pesan ?? "Nominal ini butuh persetujuan atasan.");

    ({ data, error } = await simpan());
  }
  if (error) gagal(pesanGagal(error.message));
  if (!isUuid(data?.purchase_id) || !isUuid(data?.cash_entry_id)) {
    throw new Error("Pembelian belum terkonfirmasi. Periksa daftar pembelian sebelum mengulang dengan formulir yang sama.");
  }
  for (const p of [INVOP_PATH, PATH, "/kas-bank/kas-keluar", "/keuangan/jurnal"]) revalidatePath(p);
  redirect(kembali(branch, { success: `Pembelian tersimpan (${String(data.no_bukti ?? "")}).` }));
}

/** Batalkan pembelian: Kas Keluar dibatalkan lewat jalur resmi (jurnal pembalik) dan jumlah barang dikurangi, atomik. */
export async function batalkanPembelian(formData: FormData) {
  const branch = String(formData.get("branch_id") ?? "");
  const key = String(formData.get("request_key") ?? "");
  const id = String(formData.get("purchase_id") ?? "");
  const alasan = String(formData.get("alasan") ?? "").trim();
  if (!isUuid(id) || !KEY.test(key)) redirect(kembali(branch, { error: "Formulir pembatalan tidak lengkap. Muat ulang halaman." }));
  if (alasan.length < 3 || alasan.length > 1000) redirect(kembali(branch, { error: "Alasan pembatalan wajib diisi (3–1000 huruf)." }));
  const supabase = await createClient();
  const { error } = await supabase.rpc("inventaris_operasional_batal_pembelian", { p_request_key: key, p_purchase_id: id, p_reason: alasan });
  if (error) redirect(kembali(branch, { error: pesanGagal(error.message) }));
  for (const p of [INVOP_PATH, PATH, "/kas-bank/kas-keluar", "/keuangan/jurnal"]) revalidatePath(p);
  redirect(kembali(branch, { success: "Pembelian dibatalkan; jumlah barang dan kas sudah dikoreksi." }));
}
