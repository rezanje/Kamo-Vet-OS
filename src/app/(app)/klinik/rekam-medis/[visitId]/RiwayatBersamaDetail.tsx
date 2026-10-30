import Link from "next/link";
import type { RiwayatBersama } from "@/lib/riwayat-bersama";

/**
 * RS-2: tampilan baca-saja riwayat bersama hasil impor (kunjungan tanpa cabang) untuk OWNER. Dipakai sama
 * di cabang aktif maupun "Semua cabang". Tanpa form, simpan, adendum, tagihan, persetujuan, atau rawat inap:
 * riwayat ini terkunci dari ubah langsung di database (D2).
 */
export function RiwayatBersamaDetail({ row, petName, species, breed, ownerName, phone }: {
  row: RiwayatBersama;
  petName: string;
  species: string | null;
  breed: string | null;
  ownerName: string;
  phone: string;
}) {
  const tanggal = new Date(row.tanggal).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric",
  });
  const fields: [string, string | null][] = [
    ["Dokter", row.dokter],
    ["Keluhan", row.keluhan],
    ["Anamnesis", row.anamnesis],
    ["Gejala klinis", row.gejala_klinis],
    ["Diagnosis", row.diagnosis],
    ["Terapi", row.terapi],
  ];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Link href={`/klinik/rekam-medis?pet=${encodeURIComponent(row.pet_id)}`} className="back-btn">
          <i className="ti ti-arrow-left" /> Riwayat {petName}
        </Link>
      </div>
      <div className="pg-hd" style={{ marginBottom: 2 }}>RIWAYAT LAMA (HASIL IMPOR)</div>
      <div className="pg-sub" style={{ marginBottom: 12 }}>
        {petName}{[species, breed].filter(Boolean).length ? ` · ${[species, breed].filter(Boolean).join(" · ")}` : ""} · {ownerName}{phone ? ` · ${phone}` : ""}
      </div>
      <div role="note" className="p2ban" style={{ marginBottom: 12 }}>
        Riwayat lama · semua cabang · baca saja. Riwayat hasil impor tidak bisa diubah, ditagih, atau diberi persetujuan dari sini.
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: "var(--tm)", marginBottom: 10 }}>Tanggal pemeriksaan</div>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>{tanggal}</div>
        <dl style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "8px 14px", margin: 0, fontSize: 12 }}>
          {fields.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt style={{ fontWeight: 700, color: "var(--tm)" }}>{label}</dt>
              <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{value?.trim() ? value : "—"}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

/** Gagal dimuat (bukan "tidak ada"): pesan generik tanpa detail database. */
export function RekamMedisGagalDimuat() {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Link href="/klinik/rekam-medis" className="back-btn"><i className="ti ti-arrow-left" /> Rekam medis</Link>
      </div>
      <div role="alert" className="p2ban" style={{ background: "#fef2f2", color: "#b91c1c" }}>
        Rekam medis belum dapat dimuat. Coba muat ulang.
      </div>
    </>
  );
}
