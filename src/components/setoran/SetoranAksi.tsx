import Link from "next/link";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { LampiranPicker } from "@/components/LampiranPicker";
import { KATEGORI_PENGELUARAN } from "@/lib/kategori-pengeluaran";
import { SubJudul } from "./gaya";
import { bisaDiedit, bolehVoid, PESAN_HANYA_PEMUTUS, rp, tanggalPendek, type BasisSetoran, type DetailSetoran, type Lampiran } from "@/lib/setoran";
import {
  ajukanSetoran, batalkanDraftSetoran, hapusPengeluaranSetoran, hapusTransferSetoran, putuskanTransferSetoran, setujuiSetoran, sinkronSetoran,
  tambahPengeluaranSetoran, tambahTransferSetoran, tolakSetoran, voidSetoran,
} from "@/lib/setoran-actions";

// Bagian aksi layar Detail Setoran. Staf: pengeluaran, transfer/serah tunai, ajukan. Penyetuju: konfirmasi uang masuk, setujui, tolak, void.
// Kunci permintaan dibuat per tampilan (`kunci`) supaya dobel-klik tidak menyimpan dua kali dan muat ulang membuat kunci baru.
export type Kunci = Record<string, string>;
export type Rekening = { id: string; nama: string; jenis: string; bank?: string | null };
export type Karyawan = { id: string; nama: string };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 };
const lbl: React.CSSProperties = { display: "grid", gap: 3, fontSize: 12, color: "var(--tm)" };

function Tersembunyi({ d, basis, kunci, nama }: { d: DetailSetoran; basis: BasisSetoran; kunci: Kunci; nama: string }) {
  return <>
    <input type="hidden" name="basis" value={basis} /><input type="hidden" name="id" value={d.id} />
    <input type="hidden" name="revision" value={d.revision} /><input type="hidden" name="request_key" value={kunci[nama] ?? ""} />
  </>;
}

export type UrlBukti = Record<string, string>;
function LinkLampiran({ lampiran, urls }: { lampiran: Lampiran[]; urls: UrlBukti }) {
  if (!lampiran.length) return null;
  return <span style={{ fontSize: 11.5 }}> · bukti: {lampiran.map((l, i) => <span key={l.path}>{i ? ", " : ""}{urls[l.path] ? <a href={urls[l.path]} target="_blank" rel="noopener noreferrer">{l.nama}</a> : l.nama}</span>)}</span>;
}

export function DaftarPengeluaran({ d, basis, kunci, urls }: { d: DetailSetoran; basis: BasisSetoran; kunci: Kunci; urls: UrlBukti }) {
  const edit = bisaDiedit(d.status);
  return (
    <section className="card" aria-label="Pengeluaran dari dana setoran">
      <SubJudul>Pengeluaran dari dana setoran</SubJudul>
      {d.pengeluaran_baris.length === 0 && <p style={{ fontSize: 12.5 }}>Belum ada pengeluaran.</p>}
      {d.pengeluaran_baris.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: ".5px solid var(--bd)", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13 }}>{tanggalPendek(p.tanggal)} · <strong>{p.kategori}</strong>{p.deskripsi ? ` · ${p.deskripsi}` : ""}<LinkLampiran lampiran={p.lampiran} urls={urls} />
            {p.expense_id && <span style={{ fontSize: 11.5, color: "#15803d" }}> · sudah dibukukan</span>}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong>{rp(p.jumlah)}</strong>
            {edit && <form action={hapusPengeluaranSetoran}><Tersembunyi d={d} basis={basis} kunci={kunci} nama={`hapus-${p.id}`} /><input type="hidden" name="baris" value={p.id} /><SubmitButton className="btn-def" pendingText="Menghapus…">Hapus</SubmitButton></form>}
          </div>
        </div>
      ))}
      {edit && (
        <form action={tambahPengeluaranSetoran} style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <Tersembunyi d={d} basis={basis} kunci={kunci} nama="pengeluaran" />
          <div style={grid}>
            <label style={lbl}>Tanggal<input className="fi" type="date" name="tanggal" required min={d.periode_mulai} defaultValue={d.periode_selesai} /></label>
            <label style={lbl}>Kategori<select className="fi" name="kategori" required defaultValue="">{<option value="" disabled>Pilih kategori</option>}{KATEGORI_PENGELUARAN.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
            <label style={lbl}>Jumlah (Rp)<NumberInput className="fi" type="number" name="jumlah" min="0.01" step="0.01" required /></label>
          </div>
          <label style={lbl}>Keterangan<input className="fi" name="deskripsi" maxLength={300} placeholder="mis. beli plastik" /></label>
          <label style={lbl}>Bukti (foto nota) — wajib<LampiranPicker folder={`setoran/${d.branch_id}`} wajib /></label>
          <div><SubmitButton className="btn-acc" pendingText="Menyimpan…">Tambah pengeluaran</SubmitButton></div>
        </form>
      )}
    </section>
  );
}

const WARNA_TR: Record<string, string> = { Menunggu: "#9a3412", Dikonfirmasi: "#15803d", Ditolak: "#991b1b" };

export function DaftarTransfer({ d, basis, kunci, rekening, penyetuju, pemutus, urls }: { d: DetailSetoran; basis: BasisSetoran; kunci: Kunci; rekening: Rekening[]; penyetuju: boolean; pemutus: boolean; urls: UrlBukti }) {
  const edit = bisaDiedit(d.status);
  const keputusanBuka = pemutus && (edit || d.status === "Diajukan");
  const hanyaLihatKeputusan = penyetuju && !pemutus && (edit || d.status === "Diajukan");
  return (
    <section className="card" aria-label="Setoran ke perusahaan">
      <SubJudul>Setoran ke perusahaan</SubJudul>
      {d.transfer_baris.length === 0 && <p style={{ fontSize: 12.5 }}>Belum ada setoran dicatat.</p>}
      {d.transfer_baris.map((t) => (
        <div key={t.id} style={{ padding: "8px 0", borderBottom: ".5px solid var(--bd)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>{tanggalPendek(t.tanggal)} · {t.metode} → <strong>{t.rekening}</strong> · oleh {t.dicatat_oleh}<LinkLampiran lampiran={t.lampiran} urls={urls} />{t.catatan ? ` · ${t.catatan}` : ""}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong>{rp(t.jumlah)}</strong>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: WARNA_TR[t.status] }}>{t.status}</span>
              {edit && t.status === "Menunggu" && <form action={hapusTransferSetoran}><Tersembunyi d={d} basis={basis} kunci={kunci} nama={`hapust-${t.id}`} /><input type="hidden" name="transfer" value={t.id} /><SubmitButton className="btn-def" pendingText="Menghapus…">Hapus</SubmitButton></form>}
            </div>
          </div>
          {t.status === "Ditolak" && t.alasan_tolak && <div style={{ fontSize: 12, color: "#991b1b" }}>Ditolak Finance: {t.alasan_tolak}</div>}
          {hanyaLihatKeputusan && t.status === "Menunggu" && <div data-testid="hanya-pemutus-transfer" style={{ fontSize: 12, color: "var(--tm)", marginTop: 4 }}>{PESAN_HANYA_PEMUTUS}</div>}
          {keputusanBuka && t.status === "Menunggu" && (
            <form action={putuskanTransferSetoran} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6, alignItems: "end" }}>
              <Tersembunyi d={d} basis={basis} kunci={kunci} nama={`putus-${t.id}`} /><input type="hidden" name="transfer" value={t.id} />
              <label style={{ ...lbl, flex: "1 1 180px" }}>Catatan (wajib bila ditolak)<input className="fi" name="catatan" maxLength={300} /></label>
              <SubmitButton className="btn-acc" name="keputusan" value="terima" pendingText="Memproses…">Uang sudah masuk</SubmitButton>
              <SubmitButton className="btn-def" name="keputusan" value="tolak" pendingText="Memproses…">Tolak</SubmitButton>
            </form>
          )}
        </div>
      ))}
      {edit && (
        <form action={tambahTransferSetoran} style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <Tersembunyi d={d} basis={basis} kunci={kunci} nama="transfer" />
          <div style={grid}>
            <label style={lbl}>Tanggal<input className="fi" type="date" name="tanggal" required min={d.periode_mulai} /></label>
            <label style={lbl}>Cara<select className="fi" name="metode" defaultValue="Transfer"><option>Transfer</option><option>Serah tunai</option></select></label>
            <label style={lbl}>Jumlah (Rp)<NumberInput className="fi" type="number" name="jumlah" min="0.01" step="0.01" required /></label>
            <label style={lbl}>Rekening tujuan perusahaan<select className="fi" name="rekening" required defaultValue=""><option value="" disabled>Pilih tujuan</option>{rekening.map((r) => <option key={r.id} value={r.id}>{r.jenis} · {r.nama}{r.bank ? ` (${r.bank})` : ""}</option>)}</select></label>
          </div>
          <label style={lbl}>Catatan<input className="fi" name="catatan" maxLength={300} /></label>
          <label style={lbl}>Foto bukti transfer (wajib untuk Transfer)<LampiranPicker folder={`setoran/${d.branch_id}`} /></label>
          <div><SubmitButton className="btn-acc" pendingText="Menyimpan…">Catat setoran</SubmitButton></div>
        </form>
      )}
    </section>
  );
}

export function AksiPetugas({ d, basis, kunci }: { d: DetailSetoran; basis: BasisSetoran; kunci: Kunci }) {
  const edit = bisaDiedit(d.status);
  return (
    <section className="card" aria-label="Aksi setoran">
      {d.alasan_tolak && d.status === "Ditolak" && <div className="p2ban" role="alert">Dikembalikan Finance: {d.alasan_tolak}</div>}
      {d.status === "Diajukan" && <p style={{ fontSize: 13 }}>Setoran sudah diajukan ke Finance{d.diajukan_oleh ? ` oleh ${d.diajukan_oleh}` : ""}. Tidak bisa diubah sampai Finance memutuskan.</p>}
      {d.status === "Disetujui" && <p style={{ fontSize: 13 }}>Periode setoran ini sudah ditutup.</p>}
      {d.status === "Void" && <p style={{ fontSize: 13 }}>Setoran ini dibatalkan.</p>}
      {edit && (
        <div style={{ display: "grid", gap: 10 }}>
          {d.shift_baru > 0 && (
            <form action={sinkronSetoran} className="p2ban" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <input type="hidden" name="basis" value={basis} /><input type="hidden" name="id" value={d.id} />
              <span>Ada {d.shift_baru} shift tertutup baru di periode ini yang belum dihitung.</span>
              <SubmitButton className="btn-acc" pendingText="Memuat…">Muat shift baru</SubmitButton>
            </form>
          )}
          <form action={ajukanSetoran} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Tersembunyi d={d} basis={basis} kunci={kunci} nama="ajukan" />
            <SubmitButton className="btn-acc" pendingText="Mengajukan…">Selesai disetor — ajukan penutupan</SubmitButton>
          </form>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12.5 }}>Buang setoran ini</summary>
            <form action={batalkanDraftSetoran} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              <input type="hidden" name="basis" value={basis} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="request_key" value={kunci.buang ?? ""} />
              <input className="fi" name="alasan" placeholder="Alasan (min. 3 huruf)" required minLength={3} maxLength={300} style={{ flex: "1 1 200px" }} />
              <SubmitButton className="btn-def" pendingText="Membuang…">Buang</SubmitButton>
            </form>
          </details>
        </div>
      )}
    </section>
  );
}

export type SoTerakhir = { ada: boolean; no_hasil?: string; tanggal?: string; order_id?: string; nilai_jual_kurang?: number | null; nilai_jual_lebih?: number | null };

/** Panel penyetuju — HANYA dirender bila basis data mengirim bagian keuangan (tidak pernah untuk staf). */
export function PanelPenyetuju({ d, basis, kunci, karyawan, role, so }: { d: DetailSetoran; basis: BasisSetoran; kunci: Kunci; karyawan: Karyawan[]; role: string; so: SoTerakhir | null }) {
  const k = d.keuangan;
  if (!d.penyetuju || !k) return null;
  const sel = k.selisih ?? k.selisih_sementara;
  const jenis = k.jenis ?? (sel === 0 ? "Pas" : sel < 0 ? "Kurang" : "Lebih");
  const warna = jenis === "Pas" ? "#15803d" : jenis === "Kurang" ? "#dc2626" : "#1d4ed8";
  // Basis data tetap menolak (SETORAN_PENGELUARAN_MELEBIHI / SETORAN_PEMISAHAN_TUGAS); tombol dimatikan supaya penyetuju tahu sebabnya sebelum mencoba.
  const diblokir = k.peringatan.some((w) => w.tingkat === "blokir");
  return (
    <section className="card" aria-label="Penutupan periode (Finance)" style={{ borderColor: warna }}>
      <SubJudul>Penutupan periode — keputusan hanya oleh Owner atau Finance</SubJudul>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 8 }}>
        <div><div style={{ fontSize: 11.5, color: "var(--tm)" }}>Harus disetor (kewajiban − pengeluaran)</div><strong>{rp(k.diharapkan)}</strong></div>
        <div><div style={{ fontSize: 11.5, color: "var(--tm)" }}>Uang masuk terkonfirmasi</div><strong>{rp(k.transfer_dikonfirmasi)}</strong></div>
        <div><div style={{ fontSize: 11.5, color: "var(--tm)" }}>{k.selisih === null ? "Selisih sementara" : "Selisih"}</div><strong data-testid="selisih" style={{ color: warna }}>{jenis === "Pas" ? "Pas" : `${jenis} ${rp(Math.abs(sel))}`}</strong></div>
      </div>
      {k.peringatan.length > 0 && (
        <ul aria-label="Peringatan penyetuju" data-testid="peringatan-setoran" style={{ margin: "0 0 8px", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {k.peringatan.map((w) => (
            <li key={w.kode} data-kode={w.kode} style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: ".5px solid", borderColor: w.tingkat === "blokir" ? "#dc2626" : w.tingkat === "peringatan" ? "#d97706" : "var(--bd)", background: w.tingkat === "blokir" ? "#fee2e2" : w.tingkat === "peringatan" ? "#ffedd5" : "transparent" }}>
              <strong>{w.tingkat === "blokir" ? "Tidak bisa disetujui: " : w.tingkat === "peringatan" ? "Periksa: " : "Info: "}</strong>{w.pesan}
            </li>
          ))}
        </ul>
      )}
      {k.transfer_menunggu > 0 && d.status === "Diajukan" && <p className="p2ban">Masih ada {k.transfer_menunggu} setoran yang belum dikonfirmasi/ditolak. Putuskan dulu di bagian “Setoran ke perusahaan”.</p>}
      <details style={{ marginBottom: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5 }}>Rincian per shift ({k.rincian_shift.length})</summary>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl"><thead><tr><th>Kasir</th><th>Tutup</th><th>Modal</th><th>Kas fisik tutup</th><th>Selisih tutup shift</th><th>Bersih</th></tr></thead>
            <tbody>{k.rincian_shift.map((s, i) => <tr key={i}><td>{String(s.kasir)}</td><td>{tanggalPendek(String(s.ditutup))}</td><td>{rp(Number(s.modal_awal))}</td><td>{rp(Number(s.kas_fisik_tutup))}</td><td>{rp(Number(s.selisih_tutup))}</td><td>{rp(Number(s.bersih))}</td></tr>)}</tbody></table>
        </div>
      </details>

      {d.status === "Diajukan" && !d.pemutus && <p className="p2ban" role="note" data-testid="hanya-pemutus">{PESAN_HANYA_PEMUTUS}</p>}
      {d.status === "Diajukan" && d.pemutus && (
        <>
          {jenis === "Lebih" && so && (
            <p className="p2ban" style={{ display: "block" }}>
              Uang lebih biasanya karena ada barang terjual yang lupa diinput (sering tertutup stok minus saat SO). Tidak ada offset otomatis ke stok.{" "}
              {so.ada ? <>SO terakhir cabang ini: <Link href={`/pos/opname/${so.order_id}`}>{so.no_hasil}</Link> ({so.tanggal ? tanggalPendek(so.tanggal) : "-"}){so.nilai_jual_kurang != null ? ` · kurang ${rp(so.nilai_jual_kurang)}` : ""}{so.nilai_jual_lebih != null ? ` · lebih ${rp(so.nilai_jual_lebih)}` : ""}.</> : "Belum ada hasil SO untuk cabang ini."}
            </p>
          )}
          <form action={setujuiSetoran} style={{ display: "grid", gap: 10 }}>
            <Tersembunyi d={d} basis={basis} kunci={kunci} nama="setujui" />
            {jenis === "Lebih" && <label style={lbl}>Penjelasan lebih (barang lupa input?)<input className="fi" name="penjelasan" maxLength={500} placeholder="mis. ada penjualan belum terinput, cek SO" /></label>}
            {jenis === "Kurang" && (
              <fieldset style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: 10 }}>
                <legend style={{ fontSize: 12.5 }}>Kurang {rp(Math.abs(sel))} → kasbon karyawan (Dr 182001 Cashbon Karyawan / Cr Kas)</legend>
                <p style={{ fontSize: 12.5 }}>Otomatis dibagi rata ke kasir shift: {k.penanggung_otomatis.length ? k.penanggung_otomatis.map((e) => e.nama).join(", ") : <strong>tidak ada karyawan tertaut — pilih manual atau beban perusahaan</strong>}.</p>
                {[1, 2, 3].map((i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <select className="fi" name={`employee_${i}`} defaultValue="" style={{ flex: "2 1 160px" }}><option value="">— karyawan {i} —</option>{karyawan.map((e) => <option key={e.id} value={e.id}>{e.nama}</option>)}</select>
                    <NumberInput className="fi" type="number" name={`jumlah_${i}`} min="0.01" step="0.01" placeholder="Jumlah" style={{ flex: "1 1 100px" }} />
                  </div>
                ))}
                <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="beban" /> Jadikan beban perusahaan (760002), tanpa kasbon — wajib isi catatan</label>
              </fieldset>
            )}
            {Math.abs(sel) > 5_000_000 && <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="besar" /> Selisih lebih dari Rp 5.000.000 — saya sudah memeriksa bahwa ini bukan salah ketik</label>}
            <label style={lbl}>Catatan Finance (tidak terlihat staf)<input className="fi" name="catatan" maxLength={500} /></label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><SubmitButton className="btn-acc" pendingText="Menyetujui…" disabled={diblokir}>Setujui &amp; tutup periode</SubmitButton></div>
          </form>
          <form action={tolakSetoran} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <Tersembunyi d={d} basis={basis} kunci={kunci} nama="tolak" />
            <input className="fi" name="alasan" placeholder="Alasan dikembalikan (jangan tulis nominal selisih)" required minLength={3} maxLength={300} style={{ flex: "1 1 240px" }} />
            <SubmitButton className="btn-def" pendingText="Mengembalikan…">Kembalikan ke petugas</SubmitButton>
          </form>
        </>
      )}

      {d.status === "Disetujui" && (
        <div style={{ fontSize: 13 }}>
          <p>Ditutup: <strong>{k.penyelesaian === "Kasbon" ? "kurang → kasbon karyawan" : k.penyelesaian === "BebanPerusahaan" ? "kurang → beban perusahaan" : k.penyelesaian === "PendapatanLain" ? "lebih → Pendapatan Diluar Operasional Lain (810004)" : "pas, tanpa jurnal"}</strong>.</p>
          {k.penjelasan_lebih && <p>Penjelasan lebih: {k.penjelasan_lebih}</p>}
          {k.kasbon.map((b) => <p key={b.advance_id}>Kasbon {b.nama}: {rp(b.jumlah)} ({b.mode}, status {b.status ?? "-"})</p>)}
          {bolehVoid(role) && (
            <details><summary style={{ cursor: "pointer", fontSize: 12.5 }}>Batalkan setoran ini (jurnal pembalik)</summary>
              <form action={voidSetoran} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                <Tersembunyi d={d} basis={basis} kunci={kunci} nama="void" />
                <input className="fi" name="alasan" placeholder="Alasan pembatalan (min. 3 huruf)" required minLength={3} maxLength={300} style={{ flex: "1 1 240px" }} />
                <SubmitButton className="btn-def" pendingText="Membatalkan…">Batalkan setoran</SubmitButton>
              </form>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
