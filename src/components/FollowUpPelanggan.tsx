"use client";

// Halaman Follow up pelanggan (marketing): tab, saringan, daftar kartu per cabang, tombol Buka WhatsApp (tautan biasa, TIDAK mengirim apa pun)
// dan dialog "Sudah dihubungi". Data datang dari fungsi database lewat halaman server; di sini hanya tampilan.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BATAS_BARIS_CABANG, BATAS_CATATAN, DEPAN_PILIHAN, HASIL_KONTAK, INTERVAL_GROOMING, KETERANGAN_RIWAYAT, MASA_TUNGGU_PILIHAN, PERIODE_LAMA,
  STATUS_KONTAK, TAB_FOLLOWUP, kelompokPerCabang, kelompokPerPemilik, kunciPermintaan, periksaIsianKontak, pesanWhatsapp, ringkasHewan,
  rupiah, tanggalPendek, tanggalWib, tautanFilter, tautanWhatsapp, teksHariLalu, teksTerlewat,
  type BarisFollowUp, type FilterFollowUp, type HasilDaftar, type KartuPemilik, type TabId,
} from "@/lib/marketing-followup";
import type { CatatHasil, CatatInput } from "@/lib/marketing-followup-server";

export type CatatFn = (input: CatatInput) => Promise<CatatHasil>;

const DEFINISI: Record<TabId, string> = {
  lama: "Pelanggan yang terakhir datang (klinik atau petshop) minimal sekian hari lalu, paling lama 2 tahun. Diurutkan dari total belanja terbesar, lalu jumlah kunjungan. Cabang = cabang transaksi terakhirnya.",
  grooming: "Hewan yang grooming terakhirnya sudah melewati jarak yang dipilih (bawaan 30 hari), plus jadwal grooming dari dokter. Dihitung dari layanan grooming di tagihan klinik dan kasir petshop; riwayat kunjungan ditandai sendiri.",
  hari_ini: "Jadwal follow up klinik (kontrol, vaksin, grooming, obat habis, lainnya) yang jatuh tempo hari ini atau sudah lewat. Satu pemilik satu kartu walau hewannya beberapa.",
  baru: "Pelanggan yang baru datang satu kali, 30 sampai 60 hari lalu, dan belum kembali.",
};

function Lencana({ children, warna = "#475569", latar = "#f1f5f9" }: { children: ReactNode; warna?: string; latar?: string }) {
  return <span className="bge" style={{ background: latar, color: warna }}>{children}</span>;
}

function StatusHubung({ b }: { b: BarisFollowUp }) {
  const d = b.dihubungi;
  if (!d) return <Lencana warna="#b45309" latar="#fffbeb">Belum dihubungi</Lencana>;
  return (
    <span data-status-hubung style={{ fontSize: 11 }}>
      <Lencana warna={d.sudah ? "#15803d" : "#b45309"} latar={d.sudah ? "#e8f5ee" : "#fffbeb"}>{d.sudah ? "Sudah dihubungi" : "Belum dihubungi lagi"}</Lencana>{" "}
      <span style={{ color: "var(--tm)" }}>{d.hasil}, {teksHariLalu(d.hari_lalu)}{d.oleh ? ` oleh ${d.oleh}` : ""}</span>
      {d.catatan && <div style={{ color: "var(--tm)", fontSize: 10.5, overflowWrap: "anywhere" }}>“{d.catatan}”</div>}
    </span>
  );
}

function Fakta({ tab, b }: { tab: TabId; b: BarisFollowUp }) {
  if (tab === "hari_ini") {
    return (
      <dl className="fu-facts">
        <dt>Jadwal</dt><dd>{(b.item ?? []).map((i, n) => (
          <div key={n}><b>{i.jenis}</b> · {tanggalPendek(i.tanggal)}{i.hewan ? ` · ${i.hewan}` : ""}{i.catatan ? ` — ${i.catatan}` : ""}</div>
        ))}</dd>
        <dt>Terlewat</dt><dd style={{ color: (b.hari ?? 0) > 0 ? "#b91c1c" : undefined }}>{teksTerlewat(b.hari)}</dd>
      </dl>
    );
  }
  if (tab === "grooming") {
    return (
      <dl className="fu-facts">
        <dt>Terakhir grooming</dt><dd>{tanggalPendek(tanggalWib(b.terakhir))}{b.sumber ? ` · ${b.sumber}` : ""}{b.groomer ? ` · ${b.groomer}` : ""}</dd>
        {b.jadwal && <><dt>Jadwal dokter</dt><dd>{tanggalPendek(b.jadwal)}</dd></>}
        <dt>Waktunya</dt><dd style={{ color: (b.hari ?? 0) > 0 ? "#b91c1c" : undefined }}>{teksTerlewat(b.hari)}</dd>
      </dl>
    );
  }
  return (
    <dl className="fu-facts">
      <dt>Terakhir datang</dt>
      <dd>{tanggalPendek(tanggalWib(b.terakhir))} ({teksHariLalu(b.hari)}) · {b.cabang ?? "cabang tidak tercatat"} · {b.jenis_terakhir ?? "-"}</dd>
      <dt>Total belanja</dt><dd>{rupiah(b.total_belanja)}</dd>
      <dt>Kunjungan</dt><dd>{b.kunjungan ?? "-"}×</dd>
    </dl>
  );
}

function Kartu({ tab, k, klinik, onCatat }: { tab: TabId; k: KartuPemilik; klinik: string | null; onCatat: (k: KartuPemilik) => void }) {
  const semuaSudah = k.baris.every(b => b.dihubungi?.sudah);
  const hewan = [...new Set(k.baris.flatMap(b => b.hewan))];
  const wa = tautanWhatsapp(k.wa ?? k.hp, pesanWhatsapp(tab, { pemilik: k.nama, hewan, klinik }));
  return (
    <div className="fu-card" data-kartu data-sudah={semuaSudah ? "true" : "false"}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 13, overflowWrap: "anywhere" }}>{k.nama}</b>
        <span style={{ fontSize: 11, color: "var(--tm)", whiteSpace: "nowrap" }}>{k.hp ?? "-"}</span>
      </div>
      <div style={{ fontSize: 11.5 }}><i className="ti ti-paw" /> {k.baris.length > 1 && tab === "grooming" ? hewan.join(", ") || "Hewan tidak tercatat" : ringkasHewan(k.baris[0])}</div>
      {k.baris.map((b, i) => (
        <div key={`${b.customer_id}:${b.pet_id ?? i}`} style={k.baris.length > 1 ? { borderTop: ".5px dashed var(--bd)", paddingTop: 4 } : undefined}>
          {k.baris.length > 1 && <div style={{ fontSize: 11, fontWeight: 600 }}>{b.pet_id ? b.hewan[0] : "Hewan tidak dicatat"}</div>}
          <Fakta tab={tab} b={b} />
          <div style={{ marginTop: 4 }}><StatusHubung b={b} /></div>
        </div>
      ))}
      <div className="fu-aksi">
        {wa
          ? <a className="btn-acc" style={{ background: "#16a34a", textDecoration: "none" }} href={wa} target="_blank" rel="noopener noreferrer"><i className="ti ti-brand-whatsapp" /> Buka WhatsApp</a>
          : <span style={{ fontSize: 11, color: "#b91c1c" }}>Nomor tidak sah</span>}
        <button type="button" className="btn-def" onClick={() => onCatat(k)}><i className="ti ti-check" /> Sudah dihubungi</button>
      </div>
    </div>
  );
}

export function DialogSudahDihubungi({ kartu, tab, onTutup, onSimpan }: {
  kartu: KartuPemilik; tab: TabId; onTutup: () => void; onSimpan: (hasil: string, catatan: string) => Promise<string | null>;
}) {
  const [hasil, setHasil] = useState("");
  const [catatan, setCatatan] = useState("");
  const [galat, setGalat] = useState("");
  const [proses, setProses] = useState(false);
  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    if (proses) return;
    const salah = periksaIsianKontak(hasil, catatan);
    if (salah) { setGalat(salah); return; }
    setGalat(""); setProses(true);
    const pesan = await onSimpan(hasil, catatan);
    setProses(false);
    if (pesan) setGalat(pesan);
  }
  return (
    <div className="fu-overlay" role="dialog" aria-modal="true" aria-label="Sudah dihubungi" data-dialog-kontak>
      <form className="fu-dialog" onSubmit={kirim} noValidate>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Sudah dihubungi</div>
        <div style={{ fontSize: 11.5, color: "var(--tm)", margin: "2px 0 10px" }}>{kartu.nama} · {kartu.hp ?? "-"}. Catatan ini hanya untuk tim, tidak mengirim apa pun ke pelanggan. Tab: {TAB_FOLLOWUP.find(t => t.id === tab)?.label}.</div>
        <label className="flab" htmlFor="fu-hasil">Hasil</label>
        <select id="fu-hasil" name="hasil" className="fi" style={{ width: "100%" }} value={hasil} onChange={e => setHasil(e.target.value)} required>
          <option value="">Pilih hasil…</option>
          {HASIL_KONTAK.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <label className="flab" htmlFor="fu-catatan" style={{ marginTop: 8, display: "block" }}>Catatan (boleh kosong)</label>
        <textarea id="fu-catatan" name="catatan" className="fi" style={{ width: "100%", minHeight: 70 }} maxLength={BATAS_CATATAN + 50} value={catatan} onChange={e => setCatatan(e.target.value)} />
        <div style={{ fontSize: 10, color: catatan.trim().length > BATAS_CATATAN ? "#b91c1c" : "var(--td)", textAlign: "right" }}>{catatan.trim().length}/{BATAS_CATATAN}</div>
        {galat && <div role="alert" data-galat-dialog style={{ color: "#b91c1c", fontSize: 11.5, marginTop: 6 }}>{galat}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="btn-def" onClick={onTutup} disabled={proses}>Batal</button>
          <button type="submit" className="btn-acc" disabled={proses}>{proses ? "Menyimpan…" : "Simpan"}</button>
        </div>
      </form>
    </div>
  );
}

function Saringan({ f, data }: { f: FilterFollowUp; data: HasilDaftar }) {
  return (
    <form method="get" action="/crm/follow-up" className="fu-filter" data-saringan>
      <input type="hidden" name="tab" value={f.tab} />
      <div><label className="flab" htmlFor="fu-cabang">Cabang</label>
        <select id="fu-cabang" className="fi" name="cabang" defaultValue={f.cabang}>
          <option value="">Semua cabang</option>
          {data.cabang.map(c => <option key={c.id ?? "kosong"} value={c.id ?? "kosong"}>{(c.nama ?? "Tanpa cabang (riwayat impor)")} ({c.jumlah})</option>)}
          {f.cabang && !data.cabang.some(c => (c.id ?? "kosong") === f.cabang) && <option value={f.cabang}>{f.cabang === "kosong" ? "Tanpa cabang (riwayat impor)" : "Cabang dipilih"} (0)</option>}
        </select></div>
      {f.tab === "lama" && <div><label className="flab" htmlFor="fu-hari">Tidak datang sejak</label>
        <select id="fu-hari" className="fi" name="hari" defaultValue={String(f.hari)}>
          {PERIODE_LAMA.map(h => <option key={h} value={h}>{h} hari lalu ({data.bucket[String(h) as "60" | "90" | "180"]})</option>)}
        </select></div>}
      {f.tab === "grooming" && <div><label className="flab" htmlFor="fu-interval">Grooming ulang tiap</label>
        <select id="fu-interval" className="fi" name="interval" defaultValue={String(f.interval)}>
          {INTERVAL_GROOMING.map(h => <option key={h} value={h}>{h} hari</option>)}
        </select></div>}
      {(f.tab === "grooming" || f.tab === "hari_ini") && <div><label className="flab" htmlFor="fu-depan">Termasuk jadwal</label>
        <select id="fu-depan" className="fi" name="depan" defaultValue={String(f.depan)}>
          {DEPAN_PILIHAN.map(h => <option key={h} value={h}>{h === 0 ? "sampai hari ini" : `${h} hari ke depan`}</option>)}
        </select></div>}
      <div><label className="flab" htmlFor="fu-status">Status</label>
        <select id="fu-status" className="fi" name="status" defaultValue={f.status}>
          {STATUS_KONTAK.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select></div>
      <div><label className="flab" htmlFor="fu-tunggu">Dianggap sudah selama</label>
        <select id="fu-tunggu" className="fi" name="tunggu" defaultValue={String(f.cooldown)}>
          {MASA_TUNGGU_PILIHAN.map(h => <option key={h} value={h}>{h} hari</option>)}
        </select></div>
      <div style={{ flex: "1 1 160px" }}><label className="flab" htmlFor="fu-cari">Cari nama / HP</label>
        <input id="fu-cari" className="fi" name="cari" defaultValue={f.cari} placeholder="Mis. Budi atau 0812" maxLength={60} style={{ width: "100%" }} /></div>
      <button className="btn-def" type="submit"><i className="ti ti-filter" /> Tampilkan</button>
    </form>
  );
}

export function FollowUpPelanggan({ data, filter, bolehUnduh, catat, namaKlinik = null }: {
  data: HasilDaftar; filter: FilterFollowUp; bolehUnduh: boolean; catat: CatatFn; namaKlinik?: string | null;
}) {
  const router = useRouter();
  const [sasaran, setSasaran] = useState<{ kartu: KartuPemilik; kunci: Map<string, string> } | null>(null);
  const tab = filter.tab;
  const kelompok = kelompokPerCabang(data.baris);
  const buka = (kartu: KartuPemilik) => setSasaran({ kartu, kunci: new Map(kartu.baris.map(b => [`${b.customer_id}:${b.pet_id ?? ""}`, kunciPermintaan()])) });

  async function simpan(hasil: string, catatan: string): Promise<string | null> {
    if (!sasaran) return "Pilih pelanggan dulu.";
    for (const b of sasaran.kartu.baris) {
      const r = await catat({ customerId: b.customer_id, petId: b.pet_id, tab, cabangId: b.cabang_id, hasil, catatan, kunci: sasaran.kunci.get(`${b.customer_id}:${b.pet_id ?? ""}`)! });
      if (!r.ok) return r.pesan;
    }
    setSasaran(null);
    router.refresh();
    return null;
  }

  const unduh = `/crm/follow-up/unduh?${tautanFilter(filter).split("?")[1]}`;
  const tampilRiwayat = tab !== "hari_ini";
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#e8f5ee", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-message-heart" style={{ fontSize: 22, color: "#16a34a" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>FOLLOW UP PELANGGAN</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Siapa yang perlu dihubungi. Pesan tidak terkirim otomatis: staf yang menekan Kirim di WhatsApp.</div>
        </div>
      </div>

      <nav className="fu-tabs" aria-label="Daftar follow up">
        {TAB_FOLLOWUP.map(t => (
          <Link key={t.id} href={tautanFilter(filter, { tab: t.id, cabang: "", cari: "" })} aria-current={t.id === tab ? "page" : undefined} className="back-btn" style={{
            padding: "7px 14px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
            border: ".5px solid var(--bd)", background: t.id === tab ? "var(--posb)" : "#fff", color: t.id === tab ? "#fff" : "var(--tm)",
          }}>{t.label}</Link>
        ))}
      </nav>

      {tampilRiwayat && (
        <div className="p2ban" data-banner-riwayat><i className="ti ti-info-circle" /> {KETERANGAN_RIWAYAT}
          {tab === "lama" && <> Total belanja pelanggan lama kebanyakan masih Rp0 karena itu; urutan memakai jumlah kunjungan.</>}
          {tab === "grooming" && <> Yang terbaca sebelum itu hanya kunjungan klinik bertanda grooming (&ldquo;riwayat kunjungan&rdquo;).</>}
        </div>
      )}
      <div data-definisi style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 8, lineHeight: 1.5 }}>{DEFINISI[tab]}</div>

      <Saringan f={filter} data={data} />

      <div data-ringkas style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 11.5, marginBottom: 10 }}>
        <b>{data.total.toLocaleString("id-ID")} pelanggan</b>
        <span>· {data.belum.toLocaleString("id-ID")} belum dihubungi</span>
        <span>· {data.sudah.toLocaleString("id-ID")} sudah</span>
        {data.tanpa_nomor > 0 && <span data-tanpa-nomor style={{ color: "#b45309" }}>· {data.tanpa_nomor.toLocaleString("id-ID")} tanpa nomor HP yang sah (tidak ditampilkan)</span>}
        {(data.dikecualikan.kunjungan_belum_selesai > 0 || data.dikecualikan.hewan_tiada > 0) && (
          <span style={{ color: "var(--tm)" }}>· dikecualikan: {data.dikecualikan.kunjungan_belum_selesai} kunjungan belum selesai, {data.dikecualikan.hewan_tiada} hewan sudah tiada</span>
        )}
        <span style={{ flex: 1 }} />
        {tab === "hari_ini" && <Link className="btn-def" href="/klinik/follow-up"><i className="ti ti-calendar-event" /> Daftar Follow up klinik</Link>}
        {tab === "grooming" && <Link className="btn-def" href="/laporan/jadwal-anabul"><i className="ti ti-calendar-heart" /> Jadwal Anabul</Link>}
        {bolehUnduh && <a className="btn-def" href={unduh} data-unduh><i className="ti ti-file-spreadsheet" /> Unduh Excel</a>}
      </div>

      {data.baris.length === 0 && (
        <div data-kosong className="crm-sec" style={{ textAlign: "center", color: "var(--tm)", fontSize: 12 }}>
          {filter.status === "belum" && data.sudah > 0 && data.belum === 0
            ? "Semua sudah dihubungi. Aman."
            : filter.cari || filter.cabang ? "Tidak ada pelanggan yang cocok dengan saringan ini." : "Tidak ada pelanggan di daftar ini."}
        </div>
      )}

      {kelompok.map(g => {
        const kartu = tab === "lama" || tab === "baru" ? g.baris.map(b => ({ customer_id: b.customer_id, baris: [b], nama: b.nama, hp: b.hp, wa: b.wa, cabang: b.cabang })) : kelompokPerPemilik(g.baris);
        const totalCabang = data.cabang.find(c => c.id === g.id)?.jumlah ?? g.baris.length;
        return (
          <section key={g.id ?? "kosong"} data-cabang={g.nama} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, margin: "4px 0 6px" }}>{g.nama} <span style={{ fontWeight: 400, color: "var(--tm)" }}>({totalCabang.toLocaleString("id-ID")})</span></div>
            {totalCabang > g.baris.length && <div style={{ fontSize: 10.5, color: "#b45309", marginBottom: 6 }}>Menampilkan {g.baris.length} teratas dari {totalCabang.toLocaleString("id-ID")}. Persempit dengan saringan atau unduh Excel.</div>}
            <div className="fu-grid">
              {kartu.map(k => <Kartu key={`${g.id}:${k.customer_id}`} tab={tab} k={k} klinik={namaKlinik ?? g.nama} onCatat={buka} />)}
            </div>
          </section>
        );
      })}
      <div style={{ fontSize: 10, color: "var(--td)" }}>Maksimal {BATAS_BARIS_CABANG} kartu per cabang di layar.</div>

      {sasaran && <DialogSudahDihubungi kartu={sasaran.kartu} tab={tab} onTutup={() => setSasaran(null)} onSimpan={simpan} />}
    </>
  );
}
