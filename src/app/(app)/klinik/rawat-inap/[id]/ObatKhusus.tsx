import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { hariIniWIB } from "@/lib/tanggal";
import {
  progresObat, ringkasProgres, tanggalWib,
  type Protokol, type Pemberian,
} from "@/lib/obat-inap";
import {
  tambahObatInap, catatPemberianObat, hentikanObatInap, batalkanPemberianObat,
} from "../actions";

// Obat khusus & jejak pemberiannya (permintaan drh. Ilham, 24 Agustus): protokol
// ditulis sekali, tiap suntikan dicatat sendiri — jadi dokter PJ bisa memantau dari
// jauh apakah obat 3 hari benar-benar diberikan 4× sehari, dan oleh siapa.

const RUTE = ["IV", "IM", "SC", "Oral", "Topikal"];

const jamWib = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const tglPendek = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });

export async function ObatKhusus({ recordId, aktif }: { recordId: string; aktif: boolean }) {
  const supabase = await createClient();
  const hariIni = hariIniWIB();

  const { data: obatRows } = await supabase
    .from("inpatient_medications")
    .select("id, nama_obat, dosis, rute, frekuensi_per_hari, durasi_hari, mulai_tanggal, dihentikan_at, catatan")
    .eq("inpatient_record_id", recordId)
    .order("created_at", { ascending: false });

  type ObatRow = {
    id: string; nama_obat: string; dosis: string | null; rute: string | null;
    frekuensi_per_hari: number; durasi_hari: number; mulai_tanggal: string;
    dihentikan_at: string | null; catatan: string | null;
  };
  const daftar = (obatRows ?? []) as ObatRow[];

  const { data: doseRows } = daftar.length
    ? await supabase
        .from("inpatient_med_doses")
        .select("id, medication_id, diberikan_at, nama_pemberi, catatan, dibatalkan_at")
        .in("medication_id", daftar.map((o) => o.id))
        .order("diberikan_at", { ascending: false })
    : { data: [] };

  type DoseRow = {
    id: string; medication_id: string; diberikan_at: string;
    nama_pemberi: string | null; catatan: string | null; dibatalkan_at: string | null;
  };
  const semuaDosis: Pemberian[] = ((doseRows ?? []) as DoseRow[]).map((d) => ({
    id: d.id, medicationId: d.medication_id, diberikanAt: d.diberikan_at,
    namaPemberi: d.nama_pemberi, catatan: d.catatan, dibatalkanAt: d.dibatalkan_at,
  }));

  return (
    <div className="crm-sec">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <i className="ti ti-vaccine" style={{ fontSize: 18, color: "#7c3aed" }} />
        <div style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed", letterSpacing: ".02em" }}>OBAT KHUSUS</div>
        <span style={{ fontSize: 10, color: "var(--td)" }}>
          protokol obat &amp; jejak siapa yang memberikan
        </span>
      </div>

      {daftar.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 12 }}>
          Belum ada obat berprotokol. Tambahkan di bawah — misalnya Ampi Sulbactam, 4× sehari, 3 hari.
        </div>
      )}

      <div style={{ display: "grid", gap: 10, marginBottom: aktif ? 14 : 0 }}>
        {daftar.map((o) => {
          const protokol: Protokol = {
            id: o.id, namaObat: o.nama_obat, dosis: o.dosis, rute: o.rute,
            frekuensiPerHari: o.frekuensi_per_hari, durasiHari: o.durasi_hari,
            mulaiTanggal: o.mulai_tanggal, dihentikanAt: o.dihentikan_at,
          };
          const dosisObat = semuaDosis.filter((d) => d.medicationId === o.id);
          const pr = progresObat(protokol, dosisObat, hariIni);
          const perluDiberi = !pr.selesai && pr.kurangHariIni > 0;

          return (
            <div key={o.id} style={{
              border: ".5px solid var(--bd)", borderRadius: 10, padding: 12,
              background: pr.tertinggal > 0 ? "#fef2f2" : "var(--sf1)",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {o.nama_obat}
                    {o.dosis && <span style={{ fontWeight: 400, color: "var(--tm)" }}> · {o.dosis}</span>}
                    {o.rute && <span className="bge b" style={{ marginLeft: 6, fontSize: 8.5 }}>{o.rute}</span>}
                    {pr.selesai && <span className="bge x" style={{ marginLeft: 6, fontSize: 8.5 }}>selesai</span>}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 2 }}>
                    {o.frekuensi_per_hari}× sehari selama {o.durasi_hari} hari · mulai {tglPendek(o.mulai_tanggal)}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>{ringkasProgres(pr)}</div>
                  {pr.tertinggal > 0 && (
                    <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 2 }}>
                      <i className="ti ti-alert-triangle" /> Tertinggal {pr.tertinggal} pemberian dari jadwal
                    </div>
                  )}
                  {!pr.selesai && (
                    <div style={{ fontSize: 10.5, color: perluDiberi ? "#b45309" : "#15803d", marginTop: 2 }}>
                      Hari ini {pr.diberikanHariIni} dari {pr.frekuensiPerHari}
                      {perluDiberi ? ` · kurang ${pr.kurangHariIni}×` : " · sudah lengkap"}
                    </div>
                  )}
                  {o.catatan && <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3 }}>{o.catatan}</div>}
                </div>

                {aktif && !pr.selesai && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <form action={catatPemberianObat}>
                      <input type="hidden" name="medicationId" value={o.id} />
                      <input type="hidden" name="recordId" value={recordId} />
                      <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Mencatat…"
                        style={{ background: "#7c3aed", fontSize: 11, padding: "5px 11px" }}>
                        Catat pemberian
                      </SubmitButton>
                    </form>
                    <form action={hentikanObatInap}>
                      <input type="hidden" name="medicationId" value={o.id} />
                      <input type="hidden" name="recordId" value={recordId} />
                      <SubmitButton className="btn-def" style={{ fontSize: 11, padding: "5px 11px" }} pendingText="…">
                        Hentikan
                      </SubmitButton>
                    </form>
                  </div>
                )}
              </div>

              {dosisObat.length > 0 && (
                <div style={{ marginTop: 9, borderTop: ".5px solid var(--bd)", paddingTop: 7 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--tm)", letterSpacing: ".05em", marginBottom: 4 }}>
                    JEJAK PEMBERIAN
                  </div>
                  <div style={{ display: "grid", gap: 3 }}>
                    {dosisObat.map((d) => (
                      <div key={d.id} style={{
                        fontSize: 10.5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
                        color: d.dibatalkanAt ? "var(--td)" : "inherit",
                        textDecoration: d.dibatalkanAt ? "line-through" : "none",
                      }}>
                        <span style={{ color: "var(--tm)" }}>
                          {tglPendek(tanggalWib(d.diberikanAt))} {jamWib(d.diberikanAt)}
                        </span>
                        <span>{d.namaPemberi ?? "—"}</span>
                        {d.catatan && <span style={{ color: "var(--tm)" }}>· {d.catatan}</span>}
                        {d.dibatalkanAt && <span className="bge x" style={{ fontSize: 8 }}>dibatalkan</span>}
                        {aktif && !d.dibatalkanAt && (
                          <form action={batalkanPemberianObat}>
                            <input type="hidden" name="doseId" value={d.id} />
                            <input type="hidden" name="recordId" value={recordId} />
                            <SubmitButton className="btn-def" style={{ fontSize: 9, padding: "1px 7px" }} pendingText="…">
                              Batalkan
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {aktif && (
        <form action={tambahObatInap} style={{ borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
          <input type="hidden" name="recordId" value={recordId} />
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tm)", letterSpacing: ".05em", marginBottom: 7 }}>
            TAMBAH OBAT BERPROTOKOL
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 190px" }}>
              <label className="flab">Nama obat *</label>
              <input className="fi" name="nama_obat" required maxLength={120} placeholder="mis. Ampi Sulbactam" />
            </div>
            <div style={{ width: 110 }}>
              <label className="flab">Dosis</label>
              <input className="fi" name="dosis" maxLength={60} placeholder="mis. 1 ml" />
            </div>
            <div style={{ width: 96 }}>
              <label className="flab">Rute</label>
              <select className="fi" name="rute" defaultValue="">
                <option value="">—</option>
                {RUTE.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ width: 104 }}>
              <label className="flab">Kali / hari *</label>
              <input className="fi" type="number" name="frekuensi_per_hari" min={1} max={12} defaultValue={2} required />
            </div>
            <div style={{ width: 96 }}>
              <label className="flab">Berapa hari *</label>
              <input className="fi" type="number" name="durasi_hari" min={1} max={60} defaultValue={3} required />
            </div>
            <div style={{ width: 140 }}>
              <label className="flab">Mulai</label>
              <input className="fi" type="date" name="mulai_tanggal" defaultValue={hariIni} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label className="flab">Catatan</label>
              <input className="fi" name="catatan" placeholder="mis. sesuai protokol 3 hari" />
            </div>
            <SubmitButton className="btn-acc" icon="ti-vaccine" pendingText="Menyimpan…"
              style={{ background: "#7c3aed" }}>
              Tambah obat
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
