import type { HeaderGroomer } from "@/lib/groomer-kunjungan";

/** Baris Groomer/Pelaksana di header Rekam Medis. Tidak tampil untuk kunjungan non-grooming (`info` null). */
export function GroomerHeaderField({ info }: { info: HeaderGroomer }) {
  if (!info) return null;
  return (
    <div data-testid="rekam-groomer">
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{info.label}</div>
      {info.nama
        ? <div style={{ fontSize: 12 }}>{info.nama}</div>
        : <div style={{ fontSize: 12, color: "var(--td)", fontStyle: "italic" }}>belum diisi</div>}
    </div>
  );
}
