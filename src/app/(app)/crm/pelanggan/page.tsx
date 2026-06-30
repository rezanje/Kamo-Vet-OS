import { createClient } from "@/lib/supabase/server";
import { PelangganClient, type CustomerRow } from "./PelangganClient";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

export default async function PelangganPage() {
  const supabase = await createClient();
  const { data: custData } = await supabase
    .from("customers")
    .select(
      "id, name, phone, email, dob, address, tier, keanggotaan, points, total_spending, catatan, pekerjaan, sumber_info, created_at, " +
        "pets(id, name, species, breed, gender, dob, weight, warna, sterilisasi, golongan_darah, status, created_at)"
    )
    .order("total_spending", { ascending: false });

  const customers = (custData ?? []) as unknown as CustomerRow[];
  const ids = customers.map((c) => c.id);

  // Riwayat pembelian (§1.3) + ledger poin (§1.4) per pelanggan.
  const [{ data: sales }, { data: ledger }] = ids.length
    ? await Promise.all([
        supabase
          .from("sales")
          .select("customer_id, created_at, pet_id, branches(code), pets(name), sale_items(nama, qty, harga)")
          .in("customer_id", ids)
          .order("created_at", { ascending: false }),
        supabase
          .from("point_ledger")
          .select("customer_id, created_at, description, delta, saldo")
          .in("customer_id", ids)
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  // flatten sale_items jadi baris pembelian per pelanggan.
  const purByCust: Record<string, CustomerRow["purchases"]> = {};
  for (const s of (sales ?? []) as Record<string, unknown>[]) {
    const cid = s.customer_id as string;
    const branch = one(s.branches as Rel<{ code: string }>);
    const pet = one(s.pets as Rel<{ name: string }>);
    const tgl = s.created_at as string;
    for (const it of (s.sale_items as { nama: string; qty: number; harga: number }[]) ?? []) {
      (purByCust[cid] ??= []).push({ tgl, produk: it.nama, qty: it.qty, total: it.qty * it.harga, cabang: branch?.code ?? "—", anabul: pet?.name ?? "—" });
    }
  }
  const ledByCust: Record<string, CustomerRow["ledger"]> = {};
  for (const l of (ledger ?? []) as { customer_id: string; created_at: string; description: string | null; delta: number; saldo: number }[]) {
    (ledByCust[l.customer_id] ??= []).push({ tgl: l.created_at, desc: l.description ?? "—", delta: l.delta, saldo: l.saldo });
  }

  const enriched = customers.map((c) => ({ ...c, purchases: purByCust[c.id] ?? [], ledger: ledByCust[c.id] ?? [] }));

  return <PelangganClient customers={enriched} />;
}
