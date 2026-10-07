"use client";

import { PurchaseRequestKey } from "@/components/PurchaseRequestKey";
import { LocalTransactionDraft } from "@/components/LocalTransactionDraft";
import { draftString, draftNumber } from "@/components/TransactionDraft";
import { useState } from "react";
import Link from "next/link";

// Kategori + umur berpasangan: memilih kategori mengisi umur dari standarnya,
// tapi umurnya tetap bisa ditimpa — umur riil sebuah aset bisa beda dari standar.
export function KategoriUmur({ userId, purchase = false, kategori }: { userId: string; purchase?: boolean; kategori: { id: string; nama: string; umur_bulan: number }[] }) {
  const [catId, setCatId] = useState(kategori[0]?.id ?? "");
  const [umur, setUmur] = useState<number>(kategori[0]?.umur_bulan ?? 48);

  const ganti = (id: string) => {
    setCatId(id);
    const k = kategori.find((x) => x.id === id);
    if (k) setUmur(k.umur_bulan);
  };

  const draft = { snapshot: { catId, umur }, restore: (value: Record<string, unknown>) => { if (!draftString(value.catId) || !draftNumber(value.umur)) return false; setCatId(value.catId); setUmur(value.umur); return true; }, reset: () => { setCatId(kategori[0]?.id ?? ""); setUmur(kategori[0]?.umur_bulan ?? 48); } };
  return (
    <>
      {purchase ? <PurchaseRequestKey userId={userId} scope="asset" draft={draft} /> : <LocalTransactionDraft userId={userId} scope="asset-opening" state={draft} />}
      <div>
        <label className="flab">Kategori *</label>
        <select className="fi" name="category_id" value={catId} onChange={(e) => ganti(e.target.value)} required>
          <option value="">— pilih —</option>
          {kategori.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
        </select>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
          Daftarnya diatur di <Link href="/keuangan/kategori-aset" style={{ color: "#2563eb" }}>Kategori Aset</Link>.
        </div>
      </div>
      <div>
        <label className="flab">Umur ekonomis (bulan) *</label>
        <input className="fi" name="umur_bulan" type="number" min={1} value={umur}
          onChange={(e) => setUmur(Number(e.target.value))} required />
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
          Terisi otomatis dari kategori; boleh diubah kalau umur aset ini beda.
        </div>
      </div>
    </>
  );
}
