"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function correctReturn(form: FormData) {
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "");
  if (!["sales", "purchase"].includes(kind) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Identitas retur tidak valid.");
  const base = kind === "sales" ? "/penjualan/retur" : "/pembelian/retur";
  const back = `${base}/${id}`;
  const fail = (message: string): never => redirect(`${back}?error=${encodeURIComponent(message)}`);
  const reason = String(form.get("reason") ?? "").trim();
  const evidence = String(form.get("physical_evidence") ?? "").trim();
  const key = String(form.get("requestKey") ?? "");
  const revision = Number(form.get("revision"));
  if (reason.length < 3 || evidence.length < 10 || form.get("physical_checked") !== "yes") fail("Alasan dan pemeriksaan bukti fisik wajib diisi.");
  if (!key || key.length > 120 || !Number.isInteger(revision) || revision < 0) fail("Identitas simpan belum siap. Muat ulang rincian.");
  let items: unknown;
  try { items = JSON.parse(String(form.get("items") ?? "")); } catch { fail("Rincian barang tidak valid."); }
  if (!Array.isArray(items)) fail("Rincian barang tidak valid.");
  const db = await createClient();
  const { data, error } = await db.rpc("correct_return_record", {
    p_kind: kind, p_return_id: id, p_expected_revision: revision, p_request_key: key,
    p_reason: reason, p_physical_evidence: evidence, p_items: items,
  });
  if (error || !data) fail(error?.message ?? "Hasil koreksi belum terkonfirmasi. Periksa rincian lalu coba ulang dengan identitas simpan yang sama.");
  // Revalidate the application layout so all balances, stock and reports refresh.
  revalidatePath("/", "layout");
  const scope = `return-correct:${kind}:${id}:${revision}`;
  redirect(`${back}?success=1&draft_scope=${encodeURIComponent(scope)}&draft_done=${encodeURIComponent(key)}`);
}
