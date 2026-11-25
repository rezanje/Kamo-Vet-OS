import { judulRiwayat, rupiah, ringkasPerubahan, teksHari, teksJam, teksUmur, waktuWib, tanggalPendek, type Berkas, type DetailKomplain } from "@/lib/komplain";
import { LencanaStatus, LencanaTingkat } from "./KomplainUi";
import s from "./komplain.module.css";

const Baris = ({ k, v }: { k: string; v: React.ReactNode }) => (<div><div className={s.meta}>{k}</div><div style={{ fontSize: 13 }}>{v || "—"}</div></div>);

/** Tampilan baca satu komplain: ringkasan, isi, penyelesaian, lampiran (tautan bertanda tangan, berlaku 1 jam), dan riwayat tak dapat diubah. */
export function RincianKomplain({ detail, urlBerkas }: { detail: DetailKomplain; urlBerkas: Record<string, string> }) {
  const k = detail.komplain;
  return (
    <>
      <div className="card">
        <div className="card-hd" style={{ flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{k.nomor}</span> <LencanaStatus status={k.status} /> <LencanaTingkat tingkat={k.tingkat} />
          <span style={{ color: k.terlambat ? "#b91c1c" : "var(--tm)", fontSize: 11.5 }}>{teksUmur(k)}</span>
        </div>
        <div className={s.grid2}>
          <Baris k="Cabang" v={k.cabang} /><Baris k="Asal komplain" v={k.kanal} /><Baris k="Tanggal komplain" v={tanggalPendek(k.tanggal)} /><Baris k="Kategori" v={k.kategori} />
          <Baris k="Pelanggan" v={k.nama ? `${k.nama}${k.telepon ? ` · ${k.telepon}` : ""}` : null} /><Baris k="Hewan" v={k.hewan} />
          <Baris k="Dokumen terkait" v={k.ref_jenis ? `${k.ref_jenis} ${k.ref_nomor ?? ""}` : null} /><Baris k="Nilai dipermasalahkan" v={k.nominal == null ? null : rupiah(k.nominal)} />
          <Baris k="Petugas" v={k.petugas} /><Baris k="Dicatat oleh" v={`${k.dibuat_nama ?? "—"} · ${waktuWib(k.dibuat)}`} />
          <Baris k="Karyawan terlibat" v={k.karyawan.map(x => x.name).join(", ")} />
          <Baris k="Respons pertama" v={k.respons_pertama ? `${waktuWib(k.respons_pertama)} (${teksJam(k.respons_jam)})` : "Belum ada"} />
        </div>
        <div className={s.bagian}><div className={s.meta}>Isi komplain</div><div className={s.teksPanjang}>{k.deskripsi}</div></div>
        {k.harapan && <div className={s.bagian}><div className={s.meta}>Harapan pelanggan</div><div className={s.teksPanjang}>{k.harapan}</div></div>}
        {k.ditutup && (
          <div className={s.bagian} style={{ background: "#f8fafc", borderRadius: 8, padding: 10 }}>
            <div className={s.meta}>Penyelesaian — {waktuWib(k.ditutup)} · {teksHari(k.selesai_hari)} sejak komplain</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{k.jenis_penyelesaian}</div>
            <div className={s.teksPanjang}>{k.catatan_penyelesaian}</div>
          </div>
        )}
      </div>

      {detail.berkas.length > 0 && (
        <div className={`card ${s.bagian}`}>
          <div className="card-hd"><i className="ti ti-paperclip" /> Lampiran ({detail.berkas.length})</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
            {detail.berkas.map((b: Berkas) => (
              <li key={b.id}>{urlBerkas[b.path] ? <a href={urlBerkas[b.path]} target="_blank" rel="noopener noreferrer">{b.nama}</a> : b.nama} <span className={s.meta}>· {waktuWib(b.waktu)}</span></li>
            ))}
          </ul>
        </div>
      )}

      <div className={`card ${s.bagian}`}>
        <div className="card-hd"><i className="ti ti-history" /> Riwayat (tidak bisa diubah)</div>
        <ol className={s.riwayat}>
          {detail.riwayat.map(h => (
            <li key={h.seq}>
              <b>{judulRiwayat(h.jenis)}</b>{h.jenis === "status" && h.dari && h.ke ? `: ${h.dari} → ${h.ke}` : null}
              <span className={s.meta}> · {h.oleh ?? "—"}{h.peran ? ` (${h.peran})` : ""} · {waktuWib(h.waktu)}</span>
              {h.perubahan && h.jenis !== "dibuat" && <div className={s.meta}>{ringkasPerubahan(h.perubahan)}</div>}
              {h.catatan && <div className={s.teksPanjang}>{h.catatan}</div>}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
