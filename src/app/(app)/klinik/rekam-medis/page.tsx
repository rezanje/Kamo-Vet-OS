import { ListLoadError } from "@/lib/checked-list";
import { infoHalaman } from "@/lib/pagination";
import { ListPagination, ListLoadFailure } from "@/components/ListPagination";
import Link from "next/link";
import { createClientLintasCabang } from "@/lib/supabase/server";
import {
  bacaHasilHalamanRekamMedis, HALAMAN_REKAM_MEDIS, LABEL_RIWAYAT_IMPOR, MAKS_CARI_REKAM_MEDIS, PESAN_CARI_TERLALU_PANJANG,
  type HalamanRekamMedis,
} from "@/lib/daftar-rekam-medis";
import {
  BANTUAN_CARI_OBAT, BATASAN_CARI_OBAT, MAKS_CARI_OBAT, PESAN_OBAT_BELUM_TERSEDIA, fungsiObatBelumAda, periksaCariObat, teksObatCocok,
} from "@/lib/daftar-rekam-medis-obat";
import { BukaRekamMedisLink } from "./BukaRekamMedisLink";
import { DaftarPerPasien } from "./DaftarPerPasien";
import { CaraBacaDaftar, PilihStatusDaftar, PilihTampilanDaftar, StatRingkas } from "./KontrolDaftar";
import s from "./RekamMedisDaftar.module.css";
import { bacaSemuaCabang } from "@/lib/rekam-medis-semua-cabang-server";
import type { RingkasanSemuaCabang } from "@/lib/rekam-medis-semua-cabang";
import {
  bacaKelompok, JENDELA_KUNJUNGAN, PASIEN_PER_HALAMAN, petakanKunjungan, susunDaftarPerPasien, tanggalRekamMedis,
  type BarisKunjungan, type KelompokPasien, type SumberBarisDaftar,
} from "@/lib/rekam-medis-per-pasien";

type SourceRow = SumberBarisDaftar;
const dateText = tanggalRekamMedis;
const GAGAL_JENDELA = "Rekam medis belum dapat dimuat lengkap. Coba muat ulang.";

export default async function DaftarRekamMedisPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pet?: string; hal?: string; tampilan?: string; kelompok?: string; obat?: string }>;
}) {
  const { q = "", pet: petId = "", hal, tampilan, kelompok: kelompokMentah, obat: obatMentah = "" } = await searchParams;
  const fullHistory = tampilan === "semua" || !!petId;
  const displayMode = fullHistory ? "semua" : "rawat-jalan";
  const cari = q.trim();
  // Filter "Obat / produk diberikan" (RPC p_obat). Aturan sama dengan database; teks ikut di URL dan tautan halaman.
  const periksaObat = periksaCariObat(obatMentah);
  const obatAktif = periksaObat.ok && periksaObat.aktif ? periksaObat.teks : "";
  // Per pasien (bawaan) = satu baris per hewan; Per kunjungan = daftar lama. Riwayat satu hewan (?pet=) selalu per kunjungan.
  const kelompok = petId ? "kunjungan" : bacaKelompok(kelompokMentah);
  const perPasienAktif = kelompok === "pasien";

  // Paginasi + pencarian di server: satu RPC SECURITY INVOKER (RLS pemanggil) mengembalikan jumlah + SATU halaman
  // (dulu seluruh daftar ~5 MB sekaligus, ~5 dtk, melewati batas 8 dtk). Klien TANPA header cabang + cabang aktif
  // sebagai parameter: cabang aktif + riwayat impor tanpa cabang. RLS tetap membatasi siapa melihat impor.
  // `tanpaObat`: database belum punya p_obat (jalan mundur); daftar sengaja kosong, hanya ringkasan.
  type HasilDaftar = HalamanRekamMedis<SourceRow> & { tanpaObat?: boolean };
  let hasil: HasilDaftar;
  let cabangAktif: string | null;
  let pageInfo: ReturnType<typeof infoHalaman>;
  let rowsJendela: BarisKunjungan[] | null = null;
  let perPasien: ReturnType<typeof susunDaftarPerPasien> | null = null;
  let kartuHalaman: KelompokPasien[] = [];
  let semuaCabang = new Map<string, RingkasanSemuaCabang>();
  let bacaSaja = false;
  try {
    if (cari.length > MAKS_CARI_REKAM_MEDIS) throw new ListLoadError(PESAN_CARI_TERLALU_PANJANG);
    if (!periksaObat.ok) throw new ListLoadError(periksaObat.pesan);
    const lintas = await createClientLintasCabang();
    cabangAktif = lintas.cabangAktif;
    const peranP = perlakukanBacaSaja(lintas.client);
    const bacaRpc = async (diminta: { batas: number; offset: number }): Promise<HasilDaftar> => {
      // Tanpa filter obat: panggilan PERSIS seperti sebelumnya (6 argumen), jalan di database lama maupun baru.
      const argumen = {
        p_cabang: cabangAktif, p_cari: cari || null, p_tampilan: displayMode, p_pet: petId || null,
        p_batas: diminta.batas, p_offset: diminta.offset,
      };
      const result = await lintas.client.rpc("daftar_rekam_medis_halaman", obatAktif ? { ...argumen, p_obat: obatAktif } : argumen);
      if (obatAktif && fungsiObatBelumAda(result.error)) {
        // Database belum punya p_obat (aplikasi terpasang lebih dulu): pakai panggilan lama hanya untuk ringkasan, tanpa baris,
        // supaya daftar yang BELUM disaring tidak pernah tampil seolah hasil pencarian obat.
        const lama = await lintas.client.rpc("daftar_rekam_medis_halaman", { ...argumen, p_batas: 1, p_offset: 0 });
        const ringkas = bacaHasilHalamanRekamMedis<SourceRow>(lama, { batas: 1, offset: 0 }, (pesan) => new ListLoadError(pesan));
        return { jumlah: 0, ringkasan: ringkas.ringkasan, baris: [], tanpaObat: true };
      }
      return bacaHasilHalamanRekamMedis<SourceRow>(result, diminta, (pesan) => new ListLoadError(pesan));
    };
    const baca = (halaman: number) => bacaRpc({ batas: HALAMAN_REKAM_MEDIS, offset: (halaman - 1) * HALAMAN_REKAM_MEDIS });
    if (perPasienAktif) {
      // Per pasien: RPC yang sama (filter, cabang, arsip, RLS persis daftar Per kunjungan), tetapi membaca JENDELA kunjungan
      // terbaru (2 x 200, batas RPC) lalu mengelompokkan per pet_id di aplikasi. Tanpa migrasi/RPC baru.
      const [awal, lanjut] = await Promise.all([bacaRpc({ batas: 200, offset: 0 }), bacaRpc({ batas: 200, offset: 200 })]);
      const ids = new Set<string>();
      for (const row of [...awal.baris, ...lanjut.baris]) { if (ids.has(row.id)) throw new ListLoadError(GAGAL_JENDELA); ids.add(row.id); }
      if (awal.jumlah !== lanjut.jumlah || awal.ringkasan.riwayat !== lanjut.ringkasan.riwayat) throw new ListLoadError(GAGAL_JENDELA);
      hasil = { jumlah: awal.jumlah, ringkasan: awal.ringkasan, baris: [...awal.baris, ...lanjut.baris], tanpaObat: Boolean(awal.tanpaObat || lanjut.tanpaObat) };
      rowsJendela = hasil.baris.map(petakanKunjungan);
      perPasien = susunDaftarPerPasien(rowsJendela, hasil.jumlah, JENDELA_KUNJUNGAN);
      pageInfo = infoHalaman(hal, perPasien.kelompok.length, PASIEN_PER_HALAMAN);
      // Hewan yang tampil ditentukan jendela di atas (cabang aktif + impor), tetapi jumlah kunjungan + "Terakhir" tiap
      // kartu dihitung dari SEMUA cabang yang boleh dibaca pengguna (RLS pemanggil), hanya untuk hewan di halaman ini.
      kartuHalaman = perPasien.kelompok.slice(pageInfo.from, pageInfo.to + 1);
      semuaCabang = await bacaSemuaCabang(lintas.client, kartuHalaman, { cabangAktif, tampilan: displayMode });
    } else {
      const dimintaMentah = infoHalaman(hal, Number.MAX_SAFE_INTEGER, HALAMAN_REKAM_MEDIS).page;
      // offset RPC bertipe integer: nomor halaman absurd langsung dianggap di luar jangkauan (halaman 1).
      const diminta = (dimintaMentah - 1) * HALAMAN_REKAM_MEDIS > 2_000_000_000 ? 1 : dimintaMentah;
      hasil = await baca(diminta);
      pageInfo = infoHalaman(diminta, hasil.jumlah, HALAMAN_REKAM_MEDIS);
      // Halaman di luar jangkauan kembali ke halaman 1 (sama dengan perilaku infoHalaman), dibaca ulang.
      if (pageInfo.page !== diminta) {
        hasil = await baca(pageInfo.page);
        pageInfo = infoHalaman(pageInfo.page, hasil.jumlah, HALAMAN_REKAM_MEDIS);
      }
    }
    bacaSaja = await peranP;
  } catch (error) { return <ListLoadFailure error={error} label="Rekam medis" />; }

  const obatBelumTersedia = Boolean(hasil.tanpaObat);
  const rows: BarisKunjungan[] = rowsJendela ?? hasil.baris.map(petakanKunjungan);
  const selectedPet = petId ? rows[0] : null;
  const subjudul = selectedPet
    ? `Riwayat ${selectedPet.petName} · ${selectedPet.ownerName}`
    : cabangAktif ? "Riwayat pemeriksaan cabang aktif + riwayat impor (semua cabang)" : "Riwayat pemeriksaan seluruh cabang klinik";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Klinik</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Rekam medis</span>
      </div>
      <div className={s.kepala}>
        <div>
          <div className="pg-hd" style={{ marginBottom: 2 }}>REKAM MEDIS</div>
          <div className="pg-sub" style={{ marginBottom: 0 }}>{subjudul}</div>
          <div className={s.ringkasan}>
            <StatRingkas icon="ti-medical-cross" label="RIWAYAT TERSIMPAN" value={hasil.ringkasan.riwayat} color="var(--posb)" />
            <StatRingkas icon="ti-paw" label="HEWAN TERCATAT" value={hasil.ringkasan.hewan} color="#16a34a" />
            <StatRingkas icon="ti-file-import" label="HASIL IMPORT" value={hasil.ringkasan.impor} color="#7c3aed" />
          </div>
        </div>
        {bacaSaja ? (
          <span className="bge" title="Staf hanya dapat melihat rekam medis; perubahan dilakukan dokter" style={{ fontSize: 11, padding: "5px 10px" }}>
            <i className="ti ti-eye" /> Baca saja
          </span>
        ) : <div className={s.kepalaAksi}>
          <Link href="/klinik/rekam-medis/perlu-dilengkapi" className="btn-def" style={{ textDecoration: "none" }}>
            <i className="ti ti-clipboard-list" /> Perlu dilengkapi
          </Link>
          <Link href="/klinik/rekam-medis/impor" className="btn-acc" style={{ textDecoration: "none", background: "var(--posb)" }}>
            <i className="ti ti-file-import" /> Import rekam medis
          </Link>
        </div>}
      </div>

      <div className="crm-sec">
        <form method="get" className={s.cari} role="search" aria-label="Cari rekam medis">
          <input type="hidden" name="tampilan" value={displayMode} />
          <input type="hidden" name="kelompok" value={kelompok} />
          {petId && <input type="hidden" name="pet" value={petId} />}
          <label className={s.kolom}>
            <span className={s.kolomJudul}>Pemilik, hewan, atau telepon</span>
            <input className="fi" name="q" defaultValue={q} maxLength={MAKS_CARI_REKAM_MEDIS} placeholder="Cari pemilik, hewan, atau telepon..." />
          </label>
          <label className={s.kolom}>
            <span className={s.kolomJudul}>Cari obat / produk diberikan</span>
            <input className="fi" name="obat" defaultValue={obatMentah.trim()} maxLength={MAKS_CARI_OBAT} placeholder="Mis. RC Recovery" aria-describedby="bantuan-cari-obat" />
          </label>
          <div className={s.cariAksi}>
            <button className="btn-acc" type="submit"><i className="ti ti-search" /> Cari</button>
            {(q || petId) && <Link href={`/klinik/rekam-medis?${new URLSearchParams({ tampilan: "semua", kelompok })}`} className={s.tautanHalus} title="Hapus pencarian pemilik/hewan dan tampilkan semua riwayat">{q ? "Hapus pencarian" : "Lihat semua riwayat"}</Link>}
            {obatMentah.trim() && <Link href={`/klinik/rekam-medis?${new URLSearchParams({ q, tampilan: displayMode, kelompok, ...(petId ? { pet: petId } : {}) })}`} className={s.tautanHalus}><i className="ti ti-x" /> Hapus filter obat</Link>}
          </div>
        </form>

        <div className={s.kontrol}>
          {!petId ? <PilihTampilanDaftar kelompok={kelompok} q={q} tampilan={displayMode} obat={obatAktif} /> : <span />}
          <PilihStatusDaftar q={q} kelompok={kelompok} tampilan={displayMode} obat={obatAktif} />
        </div>

        <div className={s.judulDaftar}>
          <div className={s.judulTeks}>Daftar riwayat</div>
          <CaraBacaDaftar>
            {perPasien && <p>Satu kartu per hewan. Jumlah kunjungan dan kunjungan terakhir dihitung dari semua cabang yang bisa Anda akses (tanpa kunjungan yang diarsipkan), bukan hanya cabang aktif; tombol Riwayat membuka semua kunjungan hewan itu.{obatAktif ? " Saat mencari obat, hanya hewan dengan kunjungan yang cocok yang tampil; \"Diberikan\" menjumlahkan produk yang cocok dari kunjungan-kunjungan itu dan \"Buka kunjungan yang cocok\" membuka yang terbaru." : ""}</p>}
            {!fullHistory && <p>Pasien Rawat Inap aktif ada di Status Rawat Inap. Riwayat medisnya tetap tersedia lewat Semua riwayat atau riwayat pasien.</p>}
            {cabangAktif && hasil.ringkasan.impor > 0 && (
              <p>Riwayat hasil impor tidak punya data cabang, jadi ikut tampil di setiap cabang dengan label <b>Impor</b>.</p>
            )}
            <p id="bantuan-cari-obat">{BANTUAN_CARI_OBAT} {BATASAN_CARI_OBAT}</p>
          </CaraBacaDaftar>
        </div>
        {/* Keterangan hasil: satu baris kecil tepat di atas daftar. Kata-kata sama dengan sebelumnya; tanpa pencarian tidak ada baris. */}
        {!obatBelumTersedia && (cari || obatAktif || selectedPet) && (
          <div className={s.hasil} role="status">
            {(cari || obatAktif) ? `${perPasien ? `${perPasien.kelompok.length} pasien ditemukan (${hasil.jumlah} kunjungan)` : `${hasil.jumlah} riwayat ditemukan`}${obatAktif ? ` dengan obat/produk “${obatAktif}”` : ""}.`
              : `Seluruh riwayat medis ${selectedPet?.petName}.`}
          </div>
        )}

        {obatBelumTersedia && <p role="alert" className="p2ban" style={{ background: "#fffbeb", color: "#92400e", fontSize: 12 }}>{PESAN_OBAT_BELUM_TERSEDIA}</p>}
        {obatBelumTersedia ? null : perPasien ? (
          perPasien.kelompok.length === 0 ? <PesanKosong petId={petId} obat={obatAktif} /> : (
            <>
              {perPasien.jendelaHabis && (
                <p role="status" style={{ fontSize: 11.5, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", margin: "0 0 10px" }}>
                  Menampilkan {perPasien.kelompok.length} pasien dari {JENDELA_KUNJUNGAN} kunjungan terbaru (ada {perPasien.jumlahCocok} kunjungan yang cocok). Hewan lain tidak tampil di sini; persempit pencarian (nama hewan, pemilik, atau telepon) untuk melihatnya.
                </p>
              )}
              <DaftarPerPasien kelompok={kartuHalaman} semuaCabang={semuaCabang} tampilkanObat={Boolean(obatAktif)} />
            </>
          )
        ) : rows.length === 0 ? (
          <PesanKosong petId={petId} obat={obatAktif} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className={`tbl ${s.tabelKunjungan}`} style={{ minWidth: obatAktif ? 960 : 850 }}>
              <thead>
                <tr><th>Tanggal</th><th>Pasien</th><th>Pemilik</th><th>Status pasien</th><th>Ringkasan kunjungan</th><th>Diagnosa</th>{obatAktif && <th>Obat / produk diberikan</th>}<th /></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Tanggal" style={{ whiteSpace: "nowrap", fontSize: 11 }}>{dateText(row.date)}<br />
                      <span style={{ fontSize: 10, color: "var(--td)" }}>{row.branch ?? (row.isImported ? LABEL_RIWAYAT_IMPOR : "Tanpa cabang")}</span>
                      {row.isImported && <><br /><span className="bge" title="Riwayat hasil impor data lama" style={{ fontSize: 9.5 }}>Impor</span></>}
                    </td>
                    <td data-label="Pasien"><div style={{ fontWeight: 700 }}>{row.petId ? <Link href={`/klinik/rekam-medis/pasien/${row.petId}`} title="Lihat riwayat lengkap pasien ini" style={{ color: "inherit", textDecoration: "underline" }}>{row.petName}</Link> : row.petName}</div><div style={{ fontSize: 10.5, color: "var(--tm)" }}>{[row.species, row.breed].filter(Boolean).join(" · ") || "—"}</div></td>
                    <td data-label="Pemilik"><div style={{ fontWeight: 600 }}>{row.ownerName}</div><div style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.phone || "—"}</div></td>
                    <td data-label="Status pasien" style={{ whiteSpace: "nowrap" }}><span className={`bge ${row.patientStatus.badge}`}>{row.patientStatus.label}</span></td>
                    <td data-label="Ringkasan kunjungan" style={{ maxWidth: 230, fontSize: 11, lineHeight: 1.45 }}>{row.note || "—"}</td>
                    <td data-label="Diagnosa" style={{ maxWidth: 190, fontSize: 11, lineHeight: 1.45 }}>{row.diagnosis || "Belum diisi"}</td>
                    {obatAktif && (
                      <td data-label="Obat / produk diberikan" className={s.tabelObat} style={{ maxWidth: 230 }} data-obat-cocok>
                        {row.obatCocok.length === 0 ? "—" : row.obatCocok.map((o) => (
                          <span key={`${o.sumber}|${o.nama}`}>Diberikan: {teksObatCocok(o)}</span>
                        ))}
                      </td>
                    )}
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                        {row.petId && (
                          <Link href={`/klinik/rekam-medis/pasien/${row.petId}`} className="btn-def" title="Semua kunjungan hewan ini dalam satu halaman" style={{ textDecoration: "none", padding: "5px 10px" }}>
                            <i className="ti ti-history" /> Riwayat
                          </Link>
                        )}
                        <BukaRekamMedisLink href={`/klinik/rekam-medis/${row.id}`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListPagination path="/klinik/rekam-medis" query={{ q, pet: petId, tampilan: displayMode, kelompok, obat: obatAktif }} total={perPasien ? perPasien.kelompok.length : hasil.jumlah} pageInfo={pageInfo} />
      </div>
    </>
  );
}

/**
 * Staf (front desk) membuka daftar ini dari layar sambutan klinik untuk MELIHAT riwayat (Aldi, 20 Nov): tombol
 * Perlu dilengkapi & Import (alat OWNER/ADMIN, sudah ditolak di server) disembunyikan. Gagal membaca peran = tampilan
 * lama; ini hanya tampilan, hak ubah tetap dijaga database.
 */
async function perlakukanBacaSaja(client: Awaited<ReturnType<typeof createClientLintasCabang>>["client"]): Promise<boolean> {
  try {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return false;
    const { data } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return (data as { role?: string } | null)?.role === "STAFF";
  } catch {
    return false;
  }
}

function PesanKosong({ petId, obat }: { petId: string; obat?: string }) {
  return (
    <div style={{ padding: "30px 12px", textAlign: "center", color: "var(--tm)", fontSize: 12 }}>
      <i className="ti ti-notes-off" style={{ display: "block", fontSize: 28, marginBottom: 7, color: "var(--td)" }} />
      {obat
        ? <>Tidak ada rekam medis dengan obat/produk “{obat}” untuk pencarian ini.<br />Periksa ejaan atau coba kata yang lebih pendek (mis. “recovery”).</>
        : petId ? "Belum ada riwayat medis untuk anabul ini." : "Belum ada rekam medis yang cocok."}
    </div>
  );
}
