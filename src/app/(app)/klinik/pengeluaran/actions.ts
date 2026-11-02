"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { saveExpense } from "@/lib/expense-save";

// Pengeluaran klinik memakai jalur atomik yang sama dengan kasir petshop: lampiran bukti wajib,
// cabang & laci diambil basis data dari shift KLINIK yang sedang dibuka pemanggil, dan dokumen +
// lampiran + jurnal tersimpan bersamaan (retry dengan request_key yang sama tidak menggandakan).
export async function simpanPengeluaranKlinik(formData: FormData) {
  await saveExpense(formData, "clinic");
  revalidatePath("/klinik/pengeluaran");
  revalidatePath("/pos/expense");
  revalidatePath("/buku-besar/beban");
  redirect(`/klinik/pengeluaran?success=1${transactionDraftAck(formData)}`);
}
