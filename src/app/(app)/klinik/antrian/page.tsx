import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateVisitStatus } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const STATUS_BADGE: Record<string, string> = { Menunggu: "o", Diperiksa: "b", Selesai: "g" };

export default async function AntrianPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; success?: string }>;
}) {
  const { filter = "aktif", success } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("visits")
    .select("id, poli, dokter, status, created_at, keluhan, pets(name, species), customers(name, phone), branches(code)")
    .order("created_at", { ascending: true });

  if (filter === "aktif") query = query.neq("status", "Selesai");
  if (filter === "selesai") query = query.eq("status", "Selesai");

  const { data: visits } = await query;

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Antrian Pasien</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Pasien berhasil didaftarkan, masuk antrian.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { key: "aktif", label: "Aktif" },
            { key: "selesai", label: "Selesai" },
            { key: "semua", label: "Semua" },
          ].map((t) => (
            <Link key={t.key} href={`/klinik/antrian?filter=${t.key}`}
              className="back-btn"
              style={{
                padding: "5px 12px", borderRadius: 7, border: ".5px solid var(--bd)",
                background: filter === t.key ? "var(--sb)" : "#fff",
                color: filter === t.key ? "#fff" : "var(--tm)",
              }}>
              {t.label}
            </Link>
          ))}
        </div>
        <Link href="/klinik/registrasi" className="btn-acc">+ Daftarkan pasien</Link>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Jam</th><th>Pasien</th><th>Pemilik</th><th>Cabang</th>
                <th>Poli / Keluhan</th><th>Status</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {(visits ?? []).map((v) => {
                const pet = one(v.pets);
                const cust = one(v.customers);
                const branch = one(v.branches);
                return (
                  <tr key={v.id}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtTime(v.created_at)}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{pet?.name ?? "—"}</div>
                      <div style={{ fontSize: 10, color: "var(--tm)" }}>{pet?.species}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 11.5 }}>{cust?.name ?? "—"}</div>
                      <div style={{ fontSize: 10, color: "var(--tm)" }}>{cust?.phone}</div>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{branch?.code ?? "—"}</td>
                    <td>
                      <div style={{ fontSize: 11.5 }}>{v.poli}</div>
                      {v.keluhan && <div style={{ fontSize: 10, color: "var(--tm)" }}>{v.keluhan}</div>}
                    </td>
                    <td><span className={`bge ${STATUS_BADGE[v.status]}`}>{v.status}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        {v.status === "Menunggu" && (
                          <form action={updateVisitStatus}>
                            <input type="hidden" name="id" value={v.id} />
                            <input type="hidden" name="status" value="Diperiksa" />
                            <button type="submit" className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5 }}>Panggil</button>
                          </form>
                        )}
                        {v.status === "Diperiksa" && (
                          <Link href={`/klinik/rekam-medis/${v.id}`} className="btn-acc"
                            style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                            <i className="ti ti-stethoscope" /> Rekam medis
                          </Link>
                        )}
                        {v.status === "Selesai" && (
                          <Link href={`/klinik/rekam-medis/${v.id}`} className="back-btn"
                            style={{ fontSize: 10.5 }}>Lihat</Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(visits ?? []).length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Tidak ada pasien di antrian.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
