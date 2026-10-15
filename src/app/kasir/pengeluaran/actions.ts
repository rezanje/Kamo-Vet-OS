"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { saveExpense } from "@/lib/expense-save";

export async function simpanPengeluaranKasir(formData: FormData) {
  await saveExpense(formData, "cashier");
  revalidatePath("/kasir/pengeluaran");
  revalidatePath("/pos/expense");
  revalidatePath("/buku-besar/beban");
  redirect(`/kasir/pengeluaran?success=1${transactionDraftAck(formData)}`);
}
