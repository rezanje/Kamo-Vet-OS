import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  bacaDaftarKartuTertunda, bolehKelolaKartuTertunda, HALAMAN_KARTU_TERTUNDA, KartuTertundaGagal, LABEL_KEKURANGAN,
  PESAN_GAGAL_KARTU_TERTUNDA, STATUS_KARTU_TERTUNDA, type StatusKartuTertunda,
} from "@/lib/kartu-tertunda";

const LABEL_STATUS: Record<StatusKartuTertunda, string> = { perlu_dilengkapi: "Perlu dilengkapi", selesai: "Sudah masuk riwayat", dibatalkan: "Dibatalkan" };
const tgl = (iso?: string) => (iso ? new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" }) : null);

/**
 * "Perlu Dilengkapi": kartu rekam medis lama yang belum lengkap (OWNER/ADMIN). Isinya sudah tersimpan dan bisa dibaca;
 * kartu baru masuk riwayat pasien setelah dilengkapi.
 */
export default async function KartuPerluDilengkapiPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; hal?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const status: StatusKartuTertunda = STATUS_KARTU_TERTUNDA.includes(sp.status as StatusKartuTertunda) ? (sp.status as StatusKartuTertunda) : "perlu_dilengkapi";
  const q = sp.q ?? "";
  const hal = Math.max(1, Number.parseInt(sp.hal ?? "1", 10) || 1);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let boleh = false;
  let hasil: Awaited<ReturnType<typeof bacaDaftarKartuTertunda>> | null = null;
  let gagal = false;
  try {
    boleh = await bolehKelolaKartuTertunda(supabase, user?.id);
    if (boleh) hasil = await bacaDaftarKartuTertunda(supabase, status, q, hal);
  } catch (e) {
    if (!(e instanceof KartuTertundaGagal)) throw e;
    gagal = true;
  }

  const kepala = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Link href="/klinik/rekam-medis" className="back-btn"><i className="ti ti-arrow-left" /> Rekam medis</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Perlu dilengkapi</span>
      </div>
      <div className="pg-hd" style={{ marginBottom: 2 }}>KARTU PERLU DILENGKAPI</div>
      <div className="pg-sub" style={{ marginBottom: 12 }}>
        Kartu rekam medis lama yang datanya belum lengkap. Isinya sudah tersimpan; lengkapi nomor HP, nama, atau tanggal supaya masuk ke riwayat pasien.
      </div>
    </>
  );
  if (gagal) return <>{kepala}<div role="alert" className="p2ban" style={{ background: "#fef2f2", color: "#b91c1c" }}>{PESAN_GAGAL_KARTU_TERTUNDA}</div></>;
  if (!boleh || !hasil) return <>{kepala}<div role="note" className="p2ban">Halaman ini hanya untuk OWNER/ADMIN aktif.</div></>;

  const halaman = Math.max(1, Math.ceil(hasil.total / HALAMAN_KARTU_TERTUNDA));
  const tautan = (extra: Record<string, string>) => `/klinik/rekam-medis/perlu-dilengkapi?${new URLSearchParams({ status, q, ...extra })}`;
  return (
    <>
      {kepala}
      {sp.ok && <div role="status" className="p2ban" style={{ background: "#ecfdf5", color: "#047857", marginBottom: 12 }}>{sp.ok}</div>}
      <div className="crm-sec">
        <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          {STATUS_KARTU_TERTUNDA.map((s) => (
            <Link key={s} href={`/klinik/rekam-medis/perlu-dilengkapi?${new URLSearchParams({ status: s })}`} style={{ fontWeight: s === status ? 800 : 500 }}>
              {LABEL_STATUS[s]}
            </Link>
          ))}
        </div>
        <form method="get" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
          <input type="hidden" name="status" value={status} />
          <input className="fi" name="q" defaultValue={q} placeholder="Cari pemilik, hewan, nomor, atau berkas..." style={{ width: 280 }} />
          <button className="btn-def" type="submit"><i className="ti ti-search" /> Cari</button>
        </form>
        <div style={{ fontSize: 11, color: "var(--tm)", marginBottom: 8 }}>{hasil.total} kartu · {LABEL_STATUS[status].toLowerCase()}</div>
        {hasil.baris.length === 0 ? (
          <div style={{ padding: "30px 12px", textAlign: "center", color: "var(--tm)", fontSize: 12 }}>Tidak ada kartu.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 850 }}>
              <thead><tr><th>Tanggal</th><th>Hewan</th><th>Pemilik</th><th>Kekurangan</th><th>Diagnosa</th><th>Sumber</th><th /></tr></thead>
              <tbody>
                {hasil.baris.map((k) => (
                  <tr key={k.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: 11 }}>
                      {tgl(k.isi.tanggal_usulan) ?? ([tgl(k.isi.tanggal_sel), tgl(k.isi.tanggal_tab)].filter(Boolean).join(" / ") || "—")}
                    </td>
                    <td style={{ fontWeight: 700 }}>{k.isi.patient_name || "—"}</td>
                    <td><div style={{ fontWeight: 600 }}>{k.isi.owner_name || "—"}</div><div style={{ fontSize: 10.5, color: "var(--tm)" }}>{k.isi.phone || "—"}</div></td>
                    <td style={{ fontSize: 10.5 }}>{k.kekurangan.map((x) => <span key={x} className="bge" style={{ marginRight: 4, display: "inline-block", marginBottom: 2 }}>{LABEL_KEKURANGAN[x] ?? x}</span>)}</td>
                    <td style={{ maxWidth: 190, fontSize: 11 }}>{k.isi.diagnosis || "—"}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{[k.sumber_berkas, k.sumber_sheet].filter(Boolean).join(" · ") || "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {k.status === "selesai" && k.visit_id
                        ? <Link href={`/klinik/rekam-medis/${k.visit_id}`} className="btn-def" style={{ textDecoration: "none" }}>Lihat riwayat</Link>
                        : <Link href={`/klinik/rekam-medis/perlu-dilengkapi/${k.id}`} className="btn-def" style={{ textDecoration: "none" }}>{k.status === "perlu_dilengkapi" ? "Lengkapi" : "Lihat"}</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {halaman > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, fontSize: 12 }}>
            {hal > 1 && <Link href={tautan({ hal: String(hal - 1) })}>‹ Sebelumnya</Link>}
            <span>Halaman {hal} dari {halaman}</span>
            {hal < halaman && <Link href={tautan({ hal: String(hal + 1) })}>Berikutnya ›</Link>}
          </div>
        )}
      </div>
    </>
  );
}
