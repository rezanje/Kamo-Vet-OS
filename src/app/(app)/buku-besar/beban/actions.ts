"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { saveExpense } from "@/lib/expense-save";

const back = "/buku-besar/beban";

export async function catatBeban(formData: FormData) {
  const payload = new FormData();
  for (const [key, value] of formData.entries()) payload.append(key, value);
  payload.set("branchId", String(formData.get("branch_id") ?? ""));
  payload.set("metode_bayar", String(formData.get("metode") ?? "Tunai"));
  await saveExpense(payload, "backoffice");
  revalidatePath(back);
  revalidatePath("/pos/expense");
  redirect(`${back}?success=1${transactionDraftAck(formData)}`);
}
