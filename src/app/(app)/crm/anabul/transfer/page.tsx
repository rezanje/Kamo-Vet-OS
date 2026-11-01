import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TransferForm } from "./TransferForm";

export default async function TransferPage({ searchParams }: { searchParams: Promise<{ pet?: string }> }) {
  const { pet: id } = await searchParams;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: me } = await db.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) return <p>Hanya owner/admin yang dapat mengakses transfer kepemilikan.</p>;
  const { data: pet } = await db.from("pets").select("id, name, customer_id, status").eq("id", id ?? "").maybeSingle();
  if (!pet) return <p>Anabul tidak ditemukan. <Link href="/crm/pelanggan">Kembali ke pelanggan</Link></p>;
  // Pemilik tujuan dicari di server sambil mengetik (TransferForm) — tidak lagi memuat semua pelanggan.
  const [{ data: owner }, historyResult] = await Promise.all([
    db.from("customers").select("name").eq("id", pet.customer_id).single(),
    db.from("pet_ownership_transfers").select("id, from_name, to_name, staff_name, created_at").eq("pet_id", pet.id).order("created_at", { ascending: false }),
  ]);
  return <div style={{ display: "grid", gap: 20 }}>
    <Link href="/crm/pelanggan">← Kembali ke pelanggan</Link>
    <h1>Transfer kepemilikan · {pet.name}</h1>
    <p>Pemilik sekarang: {owner?.name ?? "—"}</p>
    {historyResult.error ? <p role="alert">Data transfer belum dapat dimuat. Hubungi admin sebelum melanjutkan.</p>
      : pet.status === "Aktif" ? <TransferForm pet={pet} owner={owner?.name ?? "—"} />
      : <p>Anabul tidak aktif, kepemilikan tidak dapat dipindahkan.</p>}
    <Link href={`/klinik/rekam-medis?pet=${pet.id}`}>Buka riwayat medis</Link>
    <h2>Riwayat perpindahan</h2>
    {historyResult.error ? <p>Riwayat belum dapat dimuat.</p> : !historyResult.data?.length ? <p>Belum ada perpindahan tercatat.</p> :
      <table className="tbl"><thead><tr><th>Tanggal</th><th>Dari</th><th>Ke</th><th>Petugas</th></tr></thead>
        <tbody>{historyResult.data.map((h) => <tr key={h.id}><td>{new Date(h.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td><td>{h.from_name}</td><td>{h.to_name}</td><td>{h.staff_name}</td></tr>)}</tbody>
      </table>}
  </div>;
}
