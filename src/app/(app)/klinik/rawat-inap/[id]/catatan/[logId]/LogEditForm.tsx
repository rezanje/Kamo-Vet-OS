"use client";

import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { OPSI_MAKAN, OPSI_MINUM, OPSI_BAB, OPSI_PIPIS, OPSI_KOMUNIKASI } from "@/lib/monitoring-inap";
import { updateDailyLog } from "../../../actions";

export type LogRow = {
  id: string; log_date: string; created_at: string;
  condition_note: string; tindakan: string | null; keterangan: string | null; doctor_name: string | null;
  makan?: string | null; minum?: string | null; bab?: string | null; pipis?: string | null;
  berat?: number | string | null; suhu?: number | string | null; foto_url?: string | null;
  komunikasi_owner?: string | null; komunikasi_via?: string | null;
};

export type EditRow = {
  edited_at: string; alasan: string | null; oleh: string;
  before: { condition_note?: string; tindakan?: string | null; keterangan?: string | null; doctor_name?: string | null };
};

export function LogEditForm({ log, recordId, backHref, patient, editable, edits }: {
  log: LogRow; recordId: string; backHref: string;
  patient: { name: string; species: string; breed: string | null; noRM: string; owner: string; phone: string; address: string; tglMasuk: string; dokter: string; kondisi: string; photo: string | null };
  editable: boolean;
  edits: EditRow[];
}) {
  const d = new Date(log.created_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = log.log_date?.slice(0, 10) || `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  return (
    <form action={updateDailyLog}>
      <input type="hidden" name="logId" value={log.id} />
      <input type="hidden" name="recordId" value={recordId} />

      <div className="grid2" style={{ alignItems: "start" }}>
        {/* ===== KIRI: data pasien + isi catatan ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 12 }}>DATA PASIEN</div>
          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <div style={{ width: 84, height: 84, borderRadius: 10, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {patient.photo ? <img src={patient.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 34, color: "var(--td)" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
                <span className="bge b">{patient.species}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", marginTop: 6, fontSize: 10.5 }}>
                <MiniKV k="Pemilik" v={patient.owner} />
                <MiniKV k="No. RM" v={patient.noRM} />
                <MiniKV k="No. HP" v={patient.phone} />
                <MiniKV k="Jenis / Ras" v={patient.breed ? `${patient.species} / ${patient.breed}` : patient.species} />
                <MiniKV k="Alamat" v={patient.address} />
                <MiniKV k="Tanggal Masuk" v={patient.tglMasuk} />
                <MiniKV k="Kondisi" v={patient.kondisi} />
                <MiniKV k="Dokter PJ" v={patient.dokter || "—"} />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px" }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 16, color: "#2563eb" }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#2563eb" }}>DETAIL RAWAT INAP</span>
          </div>

          <div className="frow">
            <div>
              <label className="flab">Tanggal *</label>
              <input className="fi" type="date" name="log_date" defaultValue={dateStr} required disabled={!editable} />
            </div>
            <div>
              <label className="flab">Waktu *</label>
              <input className="fi" type="time" name="log_time" defaultValue={timeStr} required disabled={!editable} />
            </div>
          </div>
          {/* Angka pemantauan bisa dikoreksi — salah ketik suhu/berat menyesatkan
              grafik dan bisa memicu tindakan yang tidak perlu. Nilai lamanya tetap
              tersimpan di riwayat koreksi. */}
          <div className="frow">
            <div>
              <label className="flab">Berat badan (kg)</label>
              <input className="fi" type="number" name="berat" min={0} max={200} step="0.01"
                defaultValue={log.berat ?? ""} disabled={!editable} />
            </div>
            <div>
              <label className="flab">Suhu tubuh (°C)</label>
              <input className="fi" type="number" name="suhu" min={25} max={45} step="0.1"
                defaultValue={log.suhu ?? ""} disabled={!editable} />
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Makan</label>
              <select className="fi" name="makan" defaultValue={log.makan ?? ""} disabled={!editable}>
                <option value="">— belum dinilai —</option>
                {OPSI_MAKAN.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Minum</label>
              <select className="fi" name="minum" defaultValue={log.minum ?? ""} disabled={!editable}>
                <option value="">— belum dinilai —</option>
                {OPSI_MINUM.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">BAB</label>
              <select className="fi" name="bab" defaultValue={log.bab ?? ""} disabled={!editable}>
                <option value="">— belum dinilai —</option>
                {OPSI_BAB.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">BAK (pipis)</label>
              <select className="fi" name="pipis" defaultValue={log.pipis ?? ""} disabled={!editable}>
                <option value="">— belum dinilai —</option>
                {OPSI_PIPIS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {log.foto_url && (
            <div className="fg">
              <label className="flab">Foto hari itu</label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={log.foto_url} alt="Foto pasien" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 9, border: ".5px solid var(--bd)" }} />
              <input type="hidden" name="foto_url" value={log.foto_url} />
            </div>
          )}

          <div className="fg">
            <label className="flab">Kondisi umum pasien *</label>
            <textarea className="fi" name="condition_note" required rows={2} defaultValue={log.condition_note} disabled={!editable} style={{ resize: "vertical" }} />
          </div>
          <div className="fg">
            <label className="flab">Tindakan / perawatan</label>
            <textarea className="fi" name="tindakan" rows={2} defaultValue={log.tindakan ?? ""} disabled={!editable} style={{ resize: "vertical" }} />
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={2} defaultValue={log.keterangan ?? ""} disabled={!editable} style={{ resize: "vertical" }} />
          </div>
          <div className="frow">
            <div style={{ flex: 2 }}>
              <label className="flab">Yang disampaikan ke pemilik</label>
              <textarea className="fi" name="komunikasi_owner" rows={2} defaultValue={log.komunikasi_owner ?? ""}
                disabled={!editable} style={{ resize: "vertical" }} />
            </div>
            <div>
              <label className="flab">Lewat</label>
              <select className="fi" name="komunikasi_via" defaultValue={log.komunikasi_via ?? ""} disabled={!editable}>
                <option value="">— belum dihubungi —</option>
                {OPSI_KOMUNIKASI.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="fg">
            <label className="flab">Oleh dokter</label>
            <input className="fi" name="doctor_name" defaultValue={log.doctor_name ?? ""} placeholder="Drh. ..." disabled={!editable} />
          </div>

          {editable && (
            <div className="fg">
              <label className="flab">Alasan koreksi</label>
              <input className="fi" name="alasan" placeholder="mis. salah ketik suhu, koreksi jam pemberian obat" />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                <i className="ti ti-info-circle" /> Isi lama tetap tersimpan sebagai riwayat koreksi.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Link href={backHref} className="btn-def">{editable ? "Batal" : "Kembali"}</Link>
            {editable && (
              <SubmitButton className="pay-btn" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ width: "auto", flex: 1 }}>
                Simpan Perubahan
              </SubmitButton>
            )}
          </div>
        </div>

        {/* ===== KANAN: riwayat koreksi ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sb)", letterSpacing: ".02em", marginBottom: 4 }}>
            <i className="ti ti-history" style={{ color: "#d97706" }} /> RIWAYAT KOREKSI
          </div>
          <div style={{ fontSize: 10, color: "var(--td)", marginBottom: 10 }}>
            Setiap perubahan catatan tersimpan di sini beserta isi sebelumnya.
          </div>

          {edits.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--td)", padding: "10px 0" }}>
              Belum pernah dikoreksi — ini catatan asli.
            </div>
          ) : (
            edits.map((e, i) => (
              <div key={i} style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sb)" }}>{e.oleh}</span>
                  <span style={{ fontSize: 9.5, color: "var(--tm)" }}>
                    {new Date(e.edited_at).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {e.alasan && <div style={{ fontSize: 10, color: "var(--tm)", marginBottom: 6, fontStyle: "italic" }}>“{e.alasan}”</div>}
                <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--td)", marginBottom: 3 }}>ISI SEBELUMNYA</div>
                <Was k="Kondisi" v={e.before?.condition_note} />
                <Was k="Tindakan" v={e.before?.tindakan} />
                <Was k="Keterangan" v={e.before?.keterangan} />
                <Was k="Dokter" v={e.before?.doctor_name} />
              </div>
            ))
          )}

          {!editable && (
            <div className="p2ban" style={{ marginTop: 10, marginBottom: 0 }}>
              <i className="ti ti-lock" /> Rawat inap sudah ditutup — catatan dikunci, tidak bisa diubah.
            </div>
          )}
        </div>
      </div>
    </form>
  );
}

function MiniKV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      <span style={{ color: "var(--tm)", minWidth: 74 }}>{k}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>: {v}</span>
    </div>
  );
}

function Was({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 10.5, marginBottom: 2 }}>
      <span style={{ color: "var(--tm)", minWidth: 68 }}>{k}</span>
      <span style={{ color: "var(--tx)", whiteSpace: "pre-wrap" }}>{v || "—"}</span>
    </div>
  );
}
