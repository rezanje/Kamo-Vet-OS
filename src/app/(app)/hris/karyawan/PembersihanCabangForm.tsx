"use client";
import { useActionState, useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { normalisasiCari } from "@/lib/karyawan-filter";
import { setCabangUtamaMassal } from "./actions";

export type BarisTanpaCabang = {
  id: string;
  nama: string;
  nik: string | null;
  jabatan: string | null;
  peran: string;
  penugasan: string;
};

const MAKS = 200;

/**
 * T1: pembersihan terpandu cabang utama. Cabang TIDAK ditebak dari jabatan atau
 * nama — HR memilih orangnya dan cabangnya sendiri, lalu satu aksi menyimpannya
 * sekaligus. Kolom jabatan dan peran klinis ditampilkan supaya dokter dan
 * groomer bisa didahulukan.
 */
export function PembersihanCabangForm({ rows, branches }: {
  rows: BarisTanpaCabang[]; branches: { id: string; name: string }[];
}) {
  const [cari, setCari] = useState("");
  const [peran, setPeran] = useState("");
  const [dipilih, setDipilih] = useState<string[]>([]);
  const [state, simpan] = useActionState(setCabangUtamaMassal, null);
  // Centang dibersihkan saat render berikutnya setelah simpan berhasil — tanpa
  // efek, supaya tidak memicu render berantai.
  const [terakhir, setTerakhir] = useState(state);
  if (state !== terakhir) { setTerakhir(state); if (state?.ok) setDipilih([]); }

  const tampil = useMemo(() => {
    const kata = normalisasiCari(cari);
    return rows.filter(row => {
      if (peran && row.peran !== peran) return false;
      if (!kata) return true;
      return [row.nama, row.nik, row.jabatan, row.peran, row.penugasan]
        .some(nilai => nilai && normalisasiCari(String(nilai)).includes(kata));
    });
  }, [rows, cari, peran]);

  const daftarPeran = useMemo(() => [...new Set(rows.map(row => row.peran))].sort(), [rows]);
  const idTampil = tampil.map(row => row.id);
  const semuaTampilTerpilih = idTampil.length > 0 && idTampil.every(id => dipilih.includes(id));
  const sisaKuota = MAKS - dipilih.length;

  const alihkan = (id: string, aktif: boolean) =>
    setDipilih(ids => aktif ? (ids.includes(id) || ids.length >= MAKS ? ids : [...ids, id]) : ids.filter(lain => lain !== id));

  return <form action={simpan}>
    {dipilih.map(id => <input key={id} type="hidden" name="employee_ids" value={id} />)}
    {state && <div role={state.ok ? "status" : "alert"} className="p2ban"
      style={state.ok
        ? { background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }
        : { background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
      <i className={`ti ${state.ok ? "ti-circle-check" : "ti-alert-circle"}`} /> {state.pesan}
    </div>}

    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <label className="flab" htmlFor="bersih-cari">Cari karyawan</label>
        <input id="bersih-cari" className="fi" type="search" value={cari} onChange={event => setCari(event.target.value)}
          placeholder="Nama, NIK, atau jabatan…" />
      </div>
      <div>
        <label className="flab" htmlFor="bersih-peran">Peran klinis</label>
        <select id="bersih-peran" className="fi" value={peran} onChange={event => setPeran(event.target.value)} style={{ width: 160 }}>
          <option value="">Semua peran</option>
          {daftarPeran.map(nilai => <option key={nilai} value={nilai}>{nilai}</option>)}
        </select>
      </div>
      <div>
        <label className="flab" htmlFor="bersih-cabang">Cabang utama *</label>
        <select id="bersih-cabang" className="fi" name="branch_id" required defaultValue="" style={{ width: 200 }}>
          <option value="">Pilih cabang</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </div>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <label className="flab" htmlFor="bersih-alasan">Alasan (opsional)</label>
        <input id="bersih-alasan" className="fi" name="reason" minLength={3} maxLength={300} placeholder="mis. hasil pendataan ulang HR" />
      </div>
    </div>

    <div style={{ overflowX: "auto" }}>
      <table className="tbl" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ width: 34 }}>
              <input type="checkbox" aria-label="Pilih semua yang tampil" checked={semuaTampilTerpilih}
                onChange={event => setDipilih(ids => event.target.checked
                  ? [...ids, ...idTampil.filter(id => !ids.includes(id))].slice(0, MAKS)
                  : ids.filter(id => !idTampil.includes(id)))} />
            </th>
            <th>Nama</th>
            <th>NIK</th>
            <th>Jabatan</th>
            <th>Peran klinis</th>
            <th>Penugasan saat ini</th>
          </tr>
        </thead>
        <tbody>
          {tampil.map(row => {
            const terpilih = dipilih.includes(row.id);
            return <tr key={row.id}>
              <td><input type="checkbox" aria-label={`Pilih ${row.nama}`} checked={terpilih}
                disabled={!terpilih && sisaKuota <= 0}
                onChange={event => alihkan(row.id, event.target.checked)} /></td>
              <td style={{ fontWeight: 500, fontSize: 12 }}>{row.nama}</td>
              <td style={{ fontFamily: "monospace", fontSize: 10, color: "var(--tm)" }}>{row.nik ?? "—"}</td>
              <td style={{ fontSize: 11, color: "var(--tm)" }}>{row.jabatan ?? "—"}</td>
              <td style={{ fontSize: 11 }}>{row.peran}</td>
              <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.penugasan}</td>
            </tr>;
          })}
          {!tampil.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
            {rows.length ? "Tidak ada karyawan yang cocok dengan pencarian ini." : "Semua karyawan aktif sudah punya cabang utama."}
          </td></tr>}
        </tbody>
      </table>
    </div>

    <div aria-live="polite" style={{ fontSize: 11, color: "var(--tm)", marginTop: 8 }}>
      {dipilih.length} karyawan dipilih dari {tampil.length} yang tampil (maksimal {MAKS} per simpan).
    </div>
    <div style={{ marginTop: 12 }}>
      <SubmitButton className="btn-acc" icon="ti-building-store" pendingText="Menyimpan cabang…" disabled={dipilih.length === 0}>
        Set cabang utama
      </SubmitButton>
    </div>
  </form>;
}
