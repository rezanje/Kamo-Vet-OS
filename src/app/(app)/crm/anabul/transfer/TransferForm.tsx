"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transferKepemilikan } from "./actions";
import { PelangganPicker } from "@/components/PelangganPicker";
import type { PelangganDasar } from "@/lib/pelanggan-cari";

export function TransferForm({ pet, owner }: {
  pet: { id: string; name: string; customer_id: string };
  owner: string;
}) {
  const [selected, setSelected] = useState<PelangganDasar | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (success) return <p role="status">Kepemilikan berhasil dipindahkan. Riwayat medis tetap utuh.</p>;
  return <form action={(form) => startTransition(async () => {
    setError("");
    const result = await transferKepemilikan(form);
    if (result.error) setError(result.error);
    else { setSuccess(true); router.refresh(); }
  })} style={{ display: "grid", gap: 16, maxWidth: 680 }}>
    <input type="hidden" name="pet_id" value={pet.id} />
    <input type="hidden" name="from_customer_id" value={pet.customer_id} />
    <div>Pemilik tujuan (cari nama atau nomor telepon)
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: "4px 0 0" }}>
        <PelangganPicker name="to_customer_id" required kecuali={pet.customer_id} placeholder="Nama atau nomor telepon"
          onPilih={(p) => { setSelected(p); setConfirmed(false); }} />
      </fieldset>
    </div>
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
