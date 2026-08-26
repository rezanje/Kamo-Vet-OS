import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";
import { tanggalIndo, waLink } from "@/lib/followup";
import { tarikRiwayat } from "@/lib/laporan-transaksi-server";
import { profilPelanggan, dorman, rataIntervalGabungan } from "@/lib/retensi";

// Retensi Pelanggan — permintaan Kamo Group 24 Agu 2026:
// "daftar pelanggan dorman (tidak transaksi > 90 hari, ambangnya bisa diatur) per cabang"
// dan "rata-rata interval kunjungan".
//
// Ini bukan laporan untuk dibaca lalu ditutup — ini daftar kerja: siapa yang harus
// dihubungi hari ini. Karena itu nomor WA-nya langsung bisa diklik.

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const hari = (n: number) => `${Math.round(n)} hari`;

const AMBANG_BAWAAN = 90;

// Kelompok jarak kunjungan — dipakai melihat sebaran, bukan cuma rata-ratanya.
const EMBER = [
  { label: "≤ 14 hari", max: 14 },
  { label: "15–30 hari", max: 30 },
  { label: "31–60 hari", max: 60 },
  { label: "61–90 hari", max: 90 },
  { label: "> 90 hari", max: Infinity },
];

export default async function RetensiPage({
  searchParams,
}: {
  searchParams: Promise<{ ambang?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const ambang = Math.max(1, Math.min(3650, Number(sp.ambang) || AMBANG_BAWAAN));
  const cabang = sp.cabang || "";

  const hariIni = hariIniWIB();
  const supabase = await createClient();
  const [{ trx, terpotong }, { data: custData }, { data: branchData }] = await Promise.all([
    tarikRiwayat(hariIni),
    supabase.from("customers").select("id, name, phone, tier, total_spending"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  const profil = profilPelanggan(
    trx.filter((t) => t.customerId)
      .map((t) => ({ customerId: t.customerId as string, tanggal: t.tanggal, cabang: t.cabang })),
  );

  type Cust = { id: string; name: string; phone: string | null; tier: string | null; total_spending: number | null };
  const kartu = new Map(((custData ?? []) as Cust[]).map((c) => [c.id, c]));

  const belanjaPer = new Map<string, number>();
  for (const t of trx) {
    if (!t.customerId) continue;
    belanjaPer.set(t.customerId, (belanjaPer.get(t.customerId) ?? 0) + t.omzet);
  }

  const disaring = cabang ? profil.filter((p) => p.cabangPertama === cabang) : profil;
  const daftarDorman = dorman(disaring, hariIni, ambang).map((p) => {
    const c = kartu.get(p.customerId);
    return {
      ...p,
      nama: c?.name ?? "(pelanggan terhapus)",
      hp: c?.phone ?? null,
      strata: c?.tier || "New",
      belanja: belanjaPer.get(p.customerId) ?? 0,
    };
  });

  const interval = rataIntervalGabungan(disaring);
  const sebaran = EMBER.map((e, i) => {
    const bawah = i === 0 ? 0 : EMBER[i - 1].max;
    return {
      label: e.label,
      n: disaring.filter((p) => p.rataInterval !== null && (p.rataInterval as number) > bawah && (p.rataInterval as number) <= e.max).length,
    };
  });
  const sebaranPuncak = Math.max(1, ...sebaran.map((s) => s.n));

  const nilaiDorman = daftarDorman.reduce((a, r) => a + r.belanja, 0);
  const sekaliDatang = disaring.filter((p) => p.kunjungan === 1).length;

  // Pesan dibuat seragam supaya tim tidak menulis dari nol tiap kali; isinya sengaja
  // tanpa janji diskon — penawaran ditentukan marketing, bukan oleh laporan ini.
  const pesan = (nama: string) =>
    `Halo Kak ${nama}, sudah lama tidak berkunjung ke Kamo Pet Care. ` +
    `Apa kabar anabulnya? Kalau berkenan, boleh dibalas pesan ini untuk atur jadwal kunjungan ya. Terima kasih!`;

  return (
    <LaporanPage
      icon="ti-user-exclamation" title="RETENSI PELANGGAN"
      desc="Siapa yang sudah lama tidak datang, dan seberapa sering pelanggan biasanya kembali."
      filter={
        <>
          <div style={{ minWidth: 190 }}>
            <label className="flab">Dorman kalau diam lebih dari</label>
            <input className="fi" type="number" name="ambang" min={1} max={3650} defaultValue={ambang} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cabang pertama pelanggan</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(branchData ?? []).map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Pelanggan aktif tercatat", nilai: `${disaring.length} orang` },
          { label: `Dorman (> ${ambang} hari)`, nilai: `${daftarDorman.length} orang`, warna: daftarDorman.length ? "#b91c1c" : "#15803d" },
          { label: "Nilai belanja yang berhenti", nilai: rp(nilaiDorman), warna: "#b45309" },
          { label: "Rata-rata jarak kunjungan", nilai: interval.rata === null ? "belum cukup data" : hari(interval.rata) },
          { label: "Baru sekali datang", nilai: `${sekaliDatang} orang` },
        ]} />
      }
    >
      {terpotong && (
        <div className="crm-sec" style={{ marginBottom: 12, fontSize: 11, color: "#b45309" }}>
          <i className="ti ti-alert-triangle" /> Riwayat transaksinya sudah sangat panjang dan
          sebagian belum ikut terhitung — sebagian pelanggan bisa terbaca dorman padahal tidak.
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · SEBARAN JARAK KUNJUNGAN</div>
        <table className="tbl" style={{ minWidth: 460 }}>
          <thead>
            <tr>
              <th style={{ width: 130 }}>Jarak kunjungan</th>
              <th style={{ width: 90, textAlign: "center" }}>Pelanggan</th>
              <th>Grafik</th>
            </tr>
          </thead>
          <tbody>
            {sebaran.map((s) => (
              <tr key={s.label} style={s.n ? undefined : { opacity: .5 }}>
                <td style={{ fontSize: 11.5, fontWeight: 600 }}>{s.label}</td>
                <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{s.n}</td>
                <td>
                  <div style={{
                    height: 10, borderRadius: 5, background: "var(--posb)",
                    width: `${Math.max(s.n ? 3 : 0, (s.n / sebaranPuncak) * 100)}%`,
                  }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Dihitung dari pelanggan yang sudah datang lebih dari sekali ({interval.dihitungDari} orang).
          Pelanggan yang baru sekali datang belum punya jarak kunjungan — mereka tercatat terpisah
          di kartu ringkasan, dan justru merekalah sasaran paling murah untuk diajak kembali.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>
          02 · DAFTAR PELANGGAN DORMAN ({daftarDorman.length} orang)
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Pelanggan</th>
                <th style={{ width: 130 }}>Nomor HP</th>
                <th style={{ width: 90 }}>Strata</th>
                <th style={{ width: 160 }}>Cabang pertama</th>
                <th style={{ width: 110 }}>Terakhir datang</th>
                <th style={{ width: 90, textAlign: "center" }}>Diam</th>
                <th style={{ width: 80, textAlign: "center" }}>Kunjungan</th>
                <th style={{ width: 130, textAlign: "right" }}>Total belanja</th>
                <th style={{ width: 90, textAlign: "center" }}>Hubungi</th>
              </tr>
            </thead>
            <tbody>
              {daftarDorman.map((r) => (
                <tr key={r.customerId}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.hp || "—"}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.strata}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.cabangPertama}</td>
                  <td style={{ fontSize: 10.5 }}>{tanggalIndo(r.terakhir)}</td>
                  <td style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: r.hariDiam > ambang * 2 ? "#b91c1c" : "#b45309" }}>
                    {r.hariDiam}h
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11 }}>{r.kunjungan}x</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.belanja)}</td>
                  <td style={{ textAlign: "center" }}>
                    {r.hp ? (
                      <a href={waLink(r.hp, pesan(r.nama))} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 10.5, color: "#15803d", textDecoration: "none", fontWeight: 700 }}>
                        <i className="ti ti-brand-whatsapp" /> WA
                      </a>
                    ) : <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>}
                  </td>
                </tr>
              ))}
              {daftarDorman.length === 0 && (
                <TabelKosong kolom={9} pesan={`Tidak ada pelanggan yang diam lebih dari ${ambang} hari.`} />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Ambangnya bisa diubah di kotak filter — bawaannya {AMBANG_BAWAAN} hari sesuai permintaan.
          Yang dihitung adalah transaksi terakhir, baik di petshop maupun di klinik.
          Struk tanpa identitas pembeli tidak bisa dinisbahkan ke siapa pun, jadi ada kemungkinan
          orang di daftar ini sebenarnya sempat belanja tanpa menyebut nama.<br />
          Tombol WA membuka WhatsApp dengan pesan pembuka yang sudah disiapkan — isinya sengaja
          tanpa janji diskon, penawarannya ditentukan tim marketing.
        </div>
      </div>
    </LaporanPage>
  );
}
