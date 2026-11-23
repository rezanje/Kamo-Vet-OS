"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { INVOP_PATH, isUuid, parseOpnameForm, parseQty, pesanGagal } from "@/lib/inventaris-operasional";

const KEY = /^[A-Za-z0-9-]{8,160}$/;
const back = (path: string, branch: string, params: Record<string, string>) =>
  `${path}?${new URLSearchParams({ cabang: branch, ...params }).toString()}`;

/** Tambah perlengkapan cabang + saldo awal. Satu RPC atomik; kiriman ulang dengan kunci yang sama tidak dobel. */
export async function tambahBarangOperasional(formData: FormData) {
  const branch = String(formData.get("branch_id") ?? "");
  const key = String(formData.get("request_key") ?? "");
  const nama = String(formData.get("nama") ?? "").trim().replace(/\s+/g, " ");
  const satuan = String(formData.get("satuan") ?? "").trim().replace(/\s+/g, " ");
  const qty = parseQty(formData.get("qty"));
  if (!isUuid(branch) || !KEY.test(key)) redirect(`${INVOP_PATH}?error=${encodeURIComponent("Formulir tidak lengkap. Muat ulang halaman.")}`);
  if (nama.length < 2 || nama.length > 120) redirect(back(INVOP_PATH, branch, { error: "Nama barang wajib 2-120 huruf." }));
  if (satuan.length < 1 || satuan.length > 30) redirect(back(INVOP_PATH, branch, { error: "Satuan wajib diisi (maks. 30 huruf)." }));
  if (qty === null) redirect(back(INVOP_PATH, branch, { error: "Jumlah awal wajib angka 0 atau lebih (maks. 2 desimal)." }));

  const supabase = await createClient();
  const { error } = await supabase.rpc("inventaris_operasional_tambah", {
    p_request_key: key, p_branch: branch, p_nama: nama, p_satuan: satuan, p_qty: qty,
  });
  if (error) redirect(back(INVOP_PATH, branch, { error: pesanGagal(error.message) }));
  revalidatePath(INVOP_PATH);
  redirect(back(INVOP_PATH, branch, { success: `${nama} ditambahkan.` }));
}

/** Simpan opname: saldo + riwayat ditulis atomik; revisi berbeda (saldo berubah sejak dibaca) ditolak utuh.
 * Selisih tanpa alasan ditolak database dengan nama barangnya. */
export async function simpanOpnameOperasional(formData: FormData) {
  const branch = String(formData.get("branch_id") ?? "");
  const key = String(formData.get("request_key") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim();
  const opnamePath = `${INVOP_PATH}/opname`;
  if (!isUuid(branch) || !KEY.test(key)) redirect(`${opnamePath}?error=${encodeURIComponent("Formulir tidak lengkap. Muat ulang halaman.")}`);
  if (catatan.length > 500) redirect(back(opnamePath, branch, { error: "Catatan maksimal 500 huruf." }));

  const supabase = await createClient();
  // Nama barang hanya untuk pesan; isi kiriman ke database tidak bergantung pada saldo terbaru (kiriman ulang tetap identik).
  const ids = formData.getAll("item_id").map(String).filter(isUuid);
  const { data: rows } = ids.length
    ? await supabase.from("operational_inventory_items").select("id,nama").eq("branch_id", branch).in("id", ids)
    : { data: [] };
  const parsed = parseOpnameForm(formData, new Map((rows ?? []).map((r: { id: string; nama: string }) => [r.id, r.nama])));
  if (!parsed.ok) redirect(back(opnamePath, branch, { error: parsed.error }));

  const { data, error } = await supabase.rpc("inventaris_operasional_opname", {
    p_request_key: key, p_branch: branch, p_lines: parsed.lines, p_catatan: catatan || null,
  });
  if (error) redirect(back(opnamePath, branch, { error: pesanGagal(error.message) }));
  if (!isUuid(data)) throw new Error("Opname belum terkonfirmasi. Periksa riwayat cabang sebelum mengulang.");
  revalidatePath(INVOP_PATH);
  redirect(back(`${INVOP_PATH}/riwayat`, branch, { opname: data, success: "Opname tersimpan." }));
}
