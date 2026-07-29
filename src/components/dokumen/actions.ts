"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MODUL_DOKUMEN, parseLampiran, type ModulDokumen } from "@/lib/dokumen";

// Lampiran menempel ke dokumen yang SUDAH ada (PO, penjualan, dst): file-nya sudah
// diunggah klien ke bucket `dokumen`, di sini tinggal dicatat.
export async function tambahDokumen(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const modul = String(formData.get("modul") ?? "") as ModulDokumen;
  const refId = String(formData.get("ref_id") ?? "");
  const kembali = String(formData.get("kembali") ?? "/");
  if (!MODUL_DOKUMEN.includes(modul) || !refId) {
    redirect(`${kembali}?error=${encodeURIComponent("Dokumen tujuan tidak dikenal")}`);
  }

  const rows = parseLampiran(formData.get("lampiran"));
  if (rows.length === 0) {
    redirect(`${kembali}?error=${encodeURIComponent("Pilih file dulu sebelum menyimpan")}`);
  }

  const { error } = await supabase.from("document_attachments").insert(
    rows.map((r) => ({ ...r, modul, ref_id: refId, uploaded_by: user.id })),
  );
  if (error) redirect(`${kembali}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(kembali);
  redirect(`${kembali}?success=dokumen`);
}

export async function hapusDokumen(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const kembali = String(formData.get("kembali") ?? "/");
  if (!id) redirect(kembali);

  const { data: row } = await supabase
    .from("document_attachments").select("path").eq("id", id).maybeSingle();
  await supabase.from("document_attachments").delete().eq("id", id);
  // ponytail: file fisik ikut dihapus; tidak ada versi/riwayat lampiran.
  if (row?.path) await supabase.storage.from("dokumen").remove([row.path as string]);

  revalidatePath(kembali);
  redirect(kembali);
}
