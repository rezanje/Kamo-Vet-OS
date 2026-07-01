"use server";

// ponytail: server actions — buatPO, tambahSupplier, updatePOStatus (+ receiving logic).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

type ItemInput = { nama: string; qty: number; harga_beli: number };

// ─── Buat PO ──────────────────────────────────────────────────────────────────

export async function buatPO(formData: FormData) {
  const supabase = await createClient();

  const supplier_id = String(formData.get("supplier_id") ?? "").trim() || null;
  const to_warehouse_id = String(formData.get("to_warehouse_id") ?? "").trim() || null;
  const branch_id = String(formData.get("branch_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);

  let items: ItemInput[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemInput[];
  } catch {
    items = [];
  }
  items = items.filter((it) => (it.nama ?? "").trim().length > 0);

  if (!to_warehouse_id || !branch_id || items.length === 0) {
    redirect("/pembelian/baru?error=" + encodeURIComponent("Gudang, cabang, dan minimal 1 item wajib diisi."));
  }

  // no_po = PO-YYYYMMDD-NNNN (count today +1 padded 4)
  const ymd = tanggal.replace(/-/g, "");
  const startOfDay = `${tanggal}T00:00:00.000Z`;
  const { count } = await supabase
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfDay);
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const no_po = `PO-${ymd}-${seq}`;

  // compute total
  const total = items.reduce((acc, it) => acc + (Number(it.qty) || 0) * (Number(it.harga_beli) || 0), 0);

  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({ no_po, supplier_id, to_warehouse_id, branch_id, tanggal, total, status: "Draft" })
    .select("id")
    .single();

  if (poErr || !po) {
    redirect("/pembelian/baru?error=" + encodeURIComponent("Gagal membuat PO."));
  }

  const poId = (po as { id: string }).id;
  const rows = items.map((it) => ({
    po_id: poId,
    nama: String(it.nama).slice(0, 160),
    qty: Number(it.qty) || 0,
    harga_beli: Number(it.harga_beli) || 0,
  }));
  await supabase.from("purchase_order_items").insert(rows);

  revalidatePath("/pembelian");
  redirect("/pembelian?success=1");
}

// ─── Tambah Supplier ──────────────────────────────────────────────────────────

export async function tambahSupplier(formData: FormData) {
  const supabase = await createClient();
  const nama = String(formData.get("nama") ?? "").trim();
  const kontak = String(formData.get("kontak") ?? "").trim() || null;
  const telp = String(formData.get("telp") ?? "").trim() || null;
  const alamat = String(formData.get("alamat") ?? "").trim() || null;

  if (!nama) {
    redirect("/pembelian?error=" + encodeURIComponent("Nama supplier wajib diisi."));
  }

  await supabase.from("suppliers").insert({ nama, kontak, telp, alamat });

  revalidatePath("/pembelian");
  redirect("/pembelian?tab=supplier&success_sup=1");
}

// ─── Update PO Status (+ receiving logic) ─────────────────────────────────────

export async function updatePOStatus(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const newStatus = String(formData.get("status") ?? "");

  // ponytail: fetch PO + current status before changing anything.
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, no_po, total, to_warehouse_id, branch_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!po) {
    revalidatePath("/pembelian");
    return;
  }

  const currentStatus = (po as { status: string }).status;

  // Guard: skip if already Diterima (idempotent).
  if (currentStatus === "Diterima" && newStatus === "Diterima") {
    revalidatePath("/pembelian");
    return;
  }

  // Perform status update.
  await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", id);

  // ── Receiving logic (only first time → Diterima) ──
  if (newStatus === "Diterima" && currentStatus !== "Diterima") {
    const { data: poItems } = await supabase
      .from("purchase_order_items")
      .select("item_id, qty, harga_beli")
      .eq("po_id", id);

    const items = (poItems ?? []) as { item_id: string | null; qty: number; harga_beli: number }[];
    const warehouseId = (po as { to_warehouse_id: string | null }).to_warehouse_id;

    // Increment stock for each item that has a linked item_id.
    if (warehouseId) {
      for (const it of items) {
        if (!it.item_id) continue;
        const delta = Number(it.qty) || 0;
        if (delta <= 0) continue;

        const { data: existing } = await supabase
          .from("stock")
          .select("qty")
          .eq("warehouse_id", warehouseId)
          .eq("item_id", it.item_id)
          .maybeSingle();

        if (existing) {
          const newQty = Number((existing as { qty: number }).qty) + delta;
          await supabase
            .from("stock")
            .update({ qty: newQty })
            .eq("warehouse_id", warehouseId)
            .eq("item_id", it.item_id);
        } else {
          await supabase.from("stock").insert({ warehouse_id: warehouseId, item_id: it.item_id, qty: delta });
        }
      }
    }

    // Post ONE journal entry: Dr Persediaan / Cr Hutang Usaha = PO total.
    const total = Number((po as { total: number }).total) || 0;
    const noPo = (po as { no_po: string | null }).no_po ?? id;
    const branchId = (po as { branch_id: string | null }).branch_id;
    const tanggal = new Date().toISOString().slice(0, 10);

    if (total > 0) {
      await postJournal(supabase, {
        tanggal,
        deskripsi: `Penerimaan barang ${noPo}`,
        source: "purchase",
        sourceRef: noPo,
        branchId,
        lines: [
          { code: "1301", debit: total, credit: 0 },
          { code: "2101", debit: 0, credit: total },
        ],
      });
    }
  }

  revalidatePath("/pembelian");
}
