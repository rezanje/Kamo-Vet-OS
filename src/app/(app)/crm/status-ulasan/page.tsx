import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { UlasanBadge, type StatusUlasan } from "@/components/UlasanBadge";
import { simpanStatusUlasan, toggleStatusUlasan } from "./actions";

type Row = StatusUlasan & { id: string; is_active: boolean };

const NADA = [
  { v: "negatif", label: "Negatif — ditonjolkan ke kasir & admin klinik" },
  { v: "netral", label: "Netral — cuma label" },
  { v: "positif", label: "Positif — cuma label" },
];

export default async function StatusUlasanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: custRows }] = await Promise.all([
    supabase.from("customer_review_statuses").select("id, nama, warna, nada, is_active").order("nama"),
    supabase.from("customers").select("review_status_id").not("review_status_id", "is", null),
  ]);

  const status = (data ?? []) as Row[];
  const editing = edit ? status.find((s) => s.id === edit) ?? null : null;

  const pakai = new Map<string, number>();
  for (const r of custRows ?? []) {
    const k = (r as { review_status_id: string }).review_status_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  return (
    <MasterPage
      back="/crm" icon="ti-star-half" iconBg="#fee2e2" iconFg="#b91c1c"
      title="STATUS ULASAN"
      desc="Label ulasan pelanggan yang bisa ditambah sendiri — mis. bintang 1 Google"
      error={error} success={success} successMsg="Status ulasan tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah daftar status ulasan."
    >
      <div className="p2ban" style={{ marginBottom: 14 }}>
        <i className="ti ti-info-circle" /> Status di sini dipasang ke pelanggan lewat{" "}
        <Link href="/crm/pelanggan" style={{ color: "#2563eb" }}>Data Pelanggan</Link>. Yang bernada
        negatif ikut muncul sebagai peringatan di layar kasir dan antrian klinik begitu
        pelanggannya dipilih.
      </div>

      {bolehKelola && (
        <form action={simpanStatusUlasan} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 190 }}>
              <label className="flab">{editing ? "Ubah nama status" : "Status baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={60}
                placeholder="mis. Bintang 1 Google" required />
            </div>
            <div style={{ width: 230 }}>
              <label className="flab">Nada</label>
              <select className="fi" name="nada" defaultValue={editing?.nada ?? "netral"} key={`nada-${editing?.id ?? "baru"}`}>
                {NADA.map((n) => <option key={n.v} value={n.v}>{n.label}</option>)}
              </select>
            </div>
            <div style={{ width: 90 }}>
              <label className="flab">Warna</label>
              <input className="fi" name="warna" type="color" defaultValue={editing?.warna ?? "#b91c1c"}
                style={{ padding: 2, height: 32 }} key={`warna-${editing?.id ?? "baru"}`} />
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/crm/status-ulasan" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Status</th>
                <th style={{ width: 110 }}>Nada</th>
                <th style={{ width: 130 }}>Dipakai</th>
                <th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 190 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {status.map((s, i) => (
                <tr key={s.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td><UlasanBadge s={s} /></td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)", textTransform: "capitalize" }}>{s.nada}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(s.id) ?? 0} pelanggan</td>
                  <td><span className={`bge ${s.is_active ? "g" : "x"}`}>{s.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/crm/status-ulasan?edit=${s.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <form action={toggleStatusUlasan}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="aktif" value={s.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {s.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {status.length === 0 && (
                <tr><td colSpan={bolehKelola ? 6 : 5} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada status ulasan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
