"use client";

import Link from "next/link";
import { useState } from "react";
import { LABEL_IMPOR, LABEL_RAWAT_INAP, type BarisObat, type KunjunganRiwayat } from "@/lib/riwayat-pasien";

const tanggalText = (iso: string) => new Date(iso).toLocaleDateString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
});
const angkaText = (n: number, digit = 2) => n.toLocaleString("id-ID", { maximumFractionDigits: digit });

function Baris({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: "contents" }}>
      <dt style={{ fontWeight: 700, color: "var(--tm)", fontSize: 11 }}>{label}</dt>
      <dd style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>{value}</dd>
    </div>
  );
}

function DaftarItem({ label, items }: { label: string; items: BarisObat[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "contents" }}>
      <dt style={{ fontWeight: 700, color: "var(--tm)", fontSize: 11 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {items.map((it) => (
            <li key={it.id} style={{ overflowWrap: "anywhere" }}>
              {it.nama}{it.jumlah ? ` · ${it.jumlah}` : ""}{it.aturan ? <span style={{ color: "var(--tm)" }}> ({it.aturan})</span> : null}
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function Isi({ k, bisaDibuka }: { k: KunjunganRiwayat; bisaDibuka: boolean }) {
  const pemeriksaan = [
    k.suhu != null ? `Suhu ${angkaText(k.suhu, 1)} °C` : null,
    k.berat != null ? `Berat ${angkaText(k.berat)} kg` : null,
  ].filter(Boolean).join(" · ") || null;
  const adaIsi = k.anamnesa || pemeriksaan || k.gejala || k.penunjang || k.diagnosa || k.terapi || k.catatanResep || k.tindakLanjut
    || k.obat.length || k.tindakan.length;
  return (
    <div style={{ padding: "4px 14px 14px" }}>
      {!k.adaRekam && <p style={{ fontSize: 12, color: "var(--tm)", margin: "6px 0" }}>Rekam medis kunjungan ini belum terbaca. Buka rekam medis lengkap untuk melihatnya.</p>}
      {k.adaRekam && !adaIsi && <p style={{ fontSize: 12, color: "var(--tm)", margin: "6px 0" }}>Belum ada isi klinis yang tercatat.</p>}
      {adaIsi ? (
        <dl style={{ display: "grid", gridTemplateColumns: "minmax(86px, 130px) minmax(0, 1fr)", gap: "8px 12px", margin: "8px 0 0" }}>
          <Baris label="Anamnesa" value={k.anamnesa} />
          <Baris label="Pemeriksaan" value={pemeriksaan} />
          <Baris label="Gejala klinis" value={k.gejala} />
          <Baris label="Hasil penunjang" value={k.penunjang} />
          <Baris label="Diagnosa" value={k.diagnosa} />
          <Baris label="Terapi" value={k.terapi} />
          <DaftarItem label="Tindakan" items={k.tindakan} />
          <DaftarItem label="Obat / resep" items={k.obat} />
          <Baris label="Catatan" value={k.catatanResep} />
          <Baris label="Tindak lanjut" value={k.tindakLanjut} />
        </dl>
      ) : null}
      {!bisaDibuka && (
        <p style={{ fontSize: 11, color: "var(--tm)", margin: "12px 0 0" }}>
          Kunjungan di cabang {k.cabang ?? "lain"}: isinya tampil di sini, tetapi halaman lengkapnya hanya bisa dibuka dari cabang itu (ganti cabang aktif).
        </p>
      )}
      {bisaDibuka && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <Link href={`/klinik/rekam-medis/${k.visitId}`} className="btn-def" style={{ textDecoration: "none", padding: "5px 10px" }}>
            <i className="ti ti-eye" /> Buka rekam medis lengkap
          </Link>
          {k.rawatInap && (
            <Link href={`/klinik/rawat-inap/${k.rawatInap.id}`} className="btn-def" style={{ textDecoration: "none", padding: "5px 10px" }}>
              <i className="ti ti-bed" /> Buka {LABEL_RAWAT_INAP.toLowerCase()}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Kartu({ k, terbuka, onToggle, bisaDibuka }: { k: KunjunganRiwayat; terbuka: boolean; onToggle: () => void; bisaDibuka: boolean }) {
  const idBody = `riwayat-${k.visitId}`;
  const sub = [k.cabang, k.dokter, k.poli].filter(Boolean).join(" · ");
  return (
    <div className="card" data-testid="kartu-kunjungan" data-visit={k.visitId} style={{ padding: 0, marginBottom: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={terbuka}
        aria-controls={idBody}
        style={{ width: "100%", display: "flex", gap: 10, alignItems: "flex-start", textAlign: "left", background: "transparent", border: 0, padding: "12px 14px", cursor: "pointer", font: "inherit", color: "inherit" }}
      >
        <i className={`ti ${terbuka ? "ti-chevron-down" : "ti-chevron-right"}`} style={{ marginTop: 3, color: "var(--tm)" }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ fontSize: 13 }}>{tanggalText(k.tanggal)}</b>
            {k.impor && <span className="bge" title="Riwayat hasil impor data lama" style={{ fontSize: 9.5 }}>{LABEL_IMPOR}</span>}
            {k.rawatInap && <span className="bge o" style={{ fontSize: 9.5 }}>{LABEL_RAWAT_INAP}{k.rawatInap.aktif ? " · masih dirawat" : ""}</span>}
            {k.diarsipkan && <span className="bge" style={{ fontSize: 9.5 }}>Diarsipkan</span>}
          </span>
          {sub && <span style={{ display: "block", fontSize: 11, color: "var(--tm)", marginTop: 2, overflowWrap: "anywhere" }}>{sub}</span>}
          <span style={{ display: "block", fontSize: 12, marginTop: 4, overflowWrap: "anywhere" }}>
            <span style={{ color: "var(--td)" }}>Keluhan: </span>{k.keluhan ?? "—"}
          </span>
          {!terbuka && k.diagnosa && (
            <span style={{ display: "block", fontSize: 11.5, marginTop: 2, color: "var(--tm)", overflowWrap: "anywhere" }}>Diagnosa: {k.diagnosa}</span>
          )}
        </span>
      </button>
      {terbuka && <div id={idBody} role="region" aria-label={`Rekam medis ${tanggalText(k.tanggal)}`}><Isi k={k} bisaDibuka={bisaDibuka} /></div>}
    </div>
  );
}

/** Daftar kunjungan yang bisa dibuka-tutup satu per satu atau sekaligus. Kunjungan terbaru terbuka lebih dulu. */
/** Halaman detail kunjungan dibaca per cabang aktif: kunjungan cabang lain tidak punya tombol buka (akan 404), isinya tetap tampil. */
const bisaDibukaDariCabang = (k: KunjunganRiwayat, cabangAktif: string | null) => !cabangAktif || k.cabangId == null || k.cabangId === cabangAktif;

export function RiwayatPasienView({ kunjungan, cabangAktif = null }: { kunjungan: KunjunganRiwayat[]; cabangAktif?: string | null }) {
  const [terbuka, setTerbuka] = useState<ReadonlySet<string>>(() => new Set(kunjungan[0] ? [kunjungan[0].visitId] : []));
  if (!kunjungan.length) {
    return (
      <div style={{ padding: "30px 12px", textAlign: "center", color: "var(--tm)", fontSize: 12 }}>
        <i className="ti ti-notes-off" style={{ display: "block", fontSize: 28, marginBottom: 7, color: "var(--td)" }} />
        Belum ada riwayat
      </div>
    );
  }
  const toggle = (id: string) => setTerbuka((awal) => {
    const baru = new Set(awal);
    if (baru.has(id)) baru.delete(id); else baru.add(id);
    return baru;
  });
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <button type="button" className="btn-def" onClick={() => setTerbuka(new Set(kunjungan.map((k) => k.visitId)))}>
          <i className="ti ti-arrows-diagonal" /> Buka semua
        </button>
        <button type="button" className="btn-def" onClick={() => setTerbuka(new Set())}>
          <i className="ti ti-arrows-diagonal-minimize-2" /> Tutup semua
        </button>
        <span style={{ fontSize: 11, color: "var(--tm)" }}>{kunjungan.length} kunjungan, terbaru di atas</span>
      </div>
      {kunjungan.map((k) => <Kartu key={k.visitId} k={k} terbuka={terbuka.has(k.visitId)} onToggle={() => toggle(k.visitId)} bisaDibuka={bisaDibukaDariCabang(k, cabangAktif)} />)}
    </>
  );
}
