"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transferKepemilikan } from "./actions";

export function TransferForm({ pet, owner, customers }: {
  pet: { id: string; name: string; customer_id: string };
  owner: string;
  customers: { id: string; name: string; phone: string }[];
}) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const selected = customers.find((c) => c.id === target);
  const matches = customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(query.toLowerCase()));
  if (success) return <p role="status">Kepemilikan berhasil dipindahkan. Riwayat medis tetap utuh.</p>;
  return <form action={(form) => startTransition(async () => {
    setError("");
    const result = await transferKepemilikan(form);
    if (result.error) setError(result.error);
    else { setSuccess(true); router.refresh(); }
  })} style={{ display: "grid", gap: 16, maxWidth: 680 }}>
    <input type="hidden" name="pet_id" value={pet.id} />
    <input type="hidden" name="from_customer_id" value={pet.customer_id} />
    <input type="hidden" name="to_customer_id" value={target} />
    <label>Cari pemilik tujuan
      <input className="inp" value={query} placeholder="Nama atau nomor telepon" disabled={pending}
        onChange={(e) => setQuery(e.target.value)} />
    </label>
    <label>Pemilik tujuan
      <select className="inp" required value={target} disabled={pending} onChange={(e) => { setTarget(e.target.value); setConfirmed(false); }}>
        <option value="">Pilih pelanggan terdaftar</option>
        {selected && !matches.includes(selected) && <option value={selected.id}>{selected.name} · {selected.phone}</option>}
        {matches.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
      </select>
    </label>
    {selected && <div className="p2ban">{pet.name}: {owner} → {selected.name} ({selected.phone})</div>}
    <p>Rekam medis tetap melekat pada anabul. Tagihan lama dan poin tetap milik pelanggan asal.</p>
    <label style={{ display: "flex", gap: 8 }}>
      <input type="checkbox" name="confirmed" value="yes" required checked={confirmed} disabled={pending || !selected}
        onChange={(e) => setConfirmed(e.target.checked)} />
      Saya sudah memeriksa anabul dan pemilik tujuan. Pindahkan kepemilikan sekarang.
    </label>
    {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    <button className="btn-pri" disabled={pending || !selected || !confirmed}>{pending ? "Menyimpan…" : "Konfirmasi transfer kepemilikan"}</button>
  </form>;
}
