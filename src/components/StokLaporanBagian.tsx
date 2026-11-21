// Bagian yang sama di dua halaman stok (slow moving & harus order): filter, nomor halaman, definisi singkat.
import Link from "next/link";
import type { ReactNode } from "react";
import { denganTampil } from "@/lib/report-gate";
import { opsiGrupGudang } from "@/lib/stok-analisis";
import type { GudangOpsi } from "@/lib/stok-analisis-server";

export const UKURAN_HALAMAN_STOK = 100;

/** `gudangNilai` = isi URL gudang yang sudah divalidasi (`pilihGudang`): "", "petshop", "klinik", atau id gudang. */
export function FilterStok({ gudang, gudangNilai, kategoriOpsi, kategori, q }: {
  gudang: GudangOpsi[]; gudangNilai: string; kategoriOpsi: string[]; kategori: string; q: string;
}) {
  const grup = opsiGrupGudang(gudang);
  return <>
    <div><label className="flab">Hitung stok di</label>
      <select className="fi" name="gudang" defaultValue={gudangNilai} style={{ minWidth: 220 }}>
        <option value="">Semua gudang digabung</option>
        {grup.length > 0 && <optgroup label="Gabungan">
          {grup.map((g) => <option key={g.nilai} value={g.nilai}>{g.label}</option>)}
        </optgroup>}
        <optgroup label="Per gudang">
          {gudang.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </optgroup>
      </select></div>
    <div><label className="flab">Kategori</label>
      <select className="fi" name="kategori" defaultValue={kategori}>
        <option value="">Semua</option>
        {kategori && !kategoriOpsi.includes(kategori) && <option value={kategori}>{kategori}</option>}
        {kategoriOpsi.map((nama) => <option key={nama} value={nama}>{nama}</option>)}
      </select></div>
    <div><label className="flab">Cari kode / nama</label><input className="fi" name="q" defaultValue={q} placeholder="Mis. royal canin" style={{ minWidth: 190 }} /></div>
    <button className="btn-def" type="submit"><i className="ti ti-filter" /> Tampilkan</button>
  </>;
}

export function NomorHalaman({ dasar, params, halaman, total }: { dasar: string; params: Record<string, string>; halaman: number; total: number }) {
  const banyak = Math.max(1, Math.ceil(total / UKURAN_HALAMAN_STOK));
  if (banyak <= 1) return null;
  const href = (n: number) => denganTampil(`${dasar}?${new URLSearchParams({ ...params, halaman: String(n) })}`);
  return (
    <div className="no-print" style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", fontSize: 11, margin: "8px 0" }}>
      {halaman > 1 && <Link className="btn-def" href={href(halaman - 1)}>Sebelumnya</Link>}
      <span>Halaman {halaman} dari {banyak}</span>
      {halaman < banyak && <Link className="btn-def" href={href(halaman + 1)}>Berikutnya</Link>}
    </div>
  );
}

export function Definisi({ children }: { children: ReactNode }) {
  return <div data-definisi style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 8, lineHeight: 1.5 }}>{children}</div>;
}

export function halamanDari(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}
