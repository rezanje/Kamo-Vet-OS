"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertMasterAdmin } from "@/lib/master-guard";

const back = (id: string) => `/crm/kategori-pelanggan/${id}`;

export async function simpanPengecualian(formData: FormData) {
  const golonganId = String(formData.get("golongan_id") ?? "").trim();
  const supabase = await assertMasterAdmin(back(golonganId), "diskon golongan");

  // sasaran = "item:<id>" atau "kategori:<id>". Digabung jadi satu dropdown
  // supaya staff tidak bisa mengisi keduanya sekaligus — kombinasi itu ditolak
  // constraint catdisc_satu_sasaran dan pesannya tidak ramah.
  const sasaran = String(formData.get("sasaran") ?? "").trim();
  const persen = Number(formData.get("diskon_persen"));

  const gagal = (pesan: string) => redirect(`${back(golonganId)}?error=${encodeURIComponent(pesan)}`);

  if (!golonganId) gagal("Golongan tidak valid");
  if (!sasaran) gagal("Pilih dulu barang atau kategori yang mau dikecualikan");
  if (!Number.isFinite(persen) || persen < 0 || persen > 100) {
    gagal("Diskon harus antara 0 dan 100 persen");
  }

  const [jenis, id] = sasaran.split(":");
  if (!id) gagal("Sasaran tidak valid");

  const baris = {
    customer_category_id: golonganId,
    item_id: jenis === "item" ? id : null,
    item_category_id: jenis === "kategori" ? id : null,
    diskon_persen: persen,
  };

  // Sasaran yang sudah punya aturan ditimpa, bukan ditolak: staff yang mengisi
  // ulang barang yang sama jelas maksudnya mengubah angkanya.
  //
  // Hapus-lalu-simpan, BUKAN upsert: index uniknya parsial (`where item_id is
  // not null`), dan ON CONFLICT tidak bisa menunjuk index parsial lewat daftar
  // kolom saja — upsert-nya gagal dengan pesan mentah dari database.
  const kolom = jenis === "item" ? "item_id" : "item_category_id";
  await supabase.from("category_discounts")
    .delete().eq("customer_category_id", golonganId).eq(kolom, id);

  const { error } = await supabase.from("category_discounts").insert(baris);
  if (error) gagal(error.message);

  revalidatePath(back(golonganId));
  redirect(`${back(golonganId)}?success=1`);
}

export async function hapusPengecualian(formData: FormData) {
  const golonganId = String(formData.get("golongan_id") ?? "").trim();
  const supabase = await assertMasterAdmin(back(golonganId), "diskon golongan");
  const id = String(formData.get("id") ?? "");

  // Aturan pengecualian tidak dirujuk transaksi mana pun — struk menyimpan
  // angka rupiahnya, bukan aturannya. Jadi hapus beneran, bukan nonaktif.
  if (id) await supabase.from("category_discounts").delete().eq("id", id);
  revalidatePath(back(golonganId));
  redirect(back(golonganId));
}
