import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { kelompokDiagnosa, samakan } from "@/lib/diagnosa";
import { tanggalWIB, hariIniWIB } from "@/lib/tanggal";
import { tanggalIndo } from "@/lib/followup";

// Daftar Anamnesa / Penyakit — permintaan Kamo Group 24 Agu 2026.
//
// Diagnosa diketik bebas oleh dokter, jadi laporan ini sekaligus memperlihatkan
// kalau satu penyakit ditulis dengan beberapa ejaan. Itu bukan gangguan —
// justru itu yang perlu dirapikan supaya angkanya bisa dipercaya.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

export default async function AnamnesaPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string; cari?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cabang = sp.cabang || "";
  const cari = samakan(sp.cari || "");

  const supabase = await createClient();
  const [{ data: mrData }, { data: branchData }] = await Promise.all([
    supabase.from("medical_records")
      .select("id, diagnosis, anamnesis, gejala_klinis, follow_up, created_at, visits(branch_id, dokter, branches(name), pets(name, species, breed), customers(name))")
      .gte("created_at", `${dari}T00:00:00+07:00`).lte("created_at", `${sampai}T23:59:59+07:00`)
      .order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  type Mr = {
    id: string; diagnosis: string | null; anamnesis: string | null;
    gejala_klinis: string | null; follow_up: string | null; created_at: string;
    visits: Rel<{
      branch_id: string | null; dokter: string | null; branches: Rel<{ name: string }>;
      pets: Rel<{ name: string; species: string | null; breed: string | null }>;
      customers: Rel<{ name: string }>;
    }>;
  };

  const semua = ((mrData ?? []) as unknown as Mr[]).map((m) => {
    const v = one(m.visits);
    const pet = one(v?.pets ?? null);
    return {
      id: m.id,
      tanggal: tanggalWIB(m.created_at),
      branchId: v?.branch_id ?? null,
      cabang: one(v?.branches ?? null)?.name ?? "—",
      dokter: v?.dokter || "—",
      pasien: pet?.name ?? "—",
      spesies: pet?.species || "—",
      ras: pet?.breed || "—",
      pemilik: one(v?.customers ?? null)?.name ?? "—",
      diagnosis: m.diagnosis?.trim() || "",
      anamnesis: m.anamnesis?.trim() || "",
      gejala: m.gejala_klinis?.trim() || "",
      followUp: m.follow_up?.trim() || "",
    };
  });

  const disaring = semua.filter((m) =>
    (!cabang || m.branchId === cabang) &&
    (!cari || samakan(`${m.diagnosis} ${m.anamnesis} ${m.gejala}`).includes(cari)));

  const daftarPenyakit = kelompokDiagnosa(disaring.map((m) => m.diagnosis));
  const perSpesies = (() => {
    const per = new Map<string, number>();
    for (const m of disaring) per.set(m.spesies, (per.get(m.spesies) ?? 0) + 1);
    return [...per].map(([nama, n]) => ({ nama, n })).sort((a, b) => b.n - a.n);
  })();

  const tanpaDiagnosa = disaring.filter((m) => !m.diagnosis).length;
  const ejaanTidakSeragam = daftarPenyakit.filter((d) => d.ejaanLain.length > 0).length;
  const puncak = Math.max(1, ...daftarPenyakit.map((d) => d.jumlah));

  return (
    <LaporanPage
      icon="ti-report-medical" title="DAFTAR ANAMNESA & PENYAKIT"
      desc="Penyakit apa yang paling sering ditangani, dan riwayat anamnesa tiap kunjungan."
      filter={
        <>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(branchData ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cari penyakit / keluhan</label>
            <input className="fi" name="cari" defaultValue={sp.cari ?? ""} placeholder="mis. scabies" />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Rekam medis", nilai: `${disaring.length} catatan` },
          { label: "Jenis penyakit berbeda", nilai: `${daftarPenyakit.length} diagnosa` },
          { label: "Belum ada diagnosa", nilai: `${tanpaDiagnosa} catatan`, warna: tanpaDiagnosa ? "#b45309" : undefined },
          { label: "Ejaan tidak seragam", nilai: `${ejaanTidakSeragam} istilah`, warna: ejaanTidakSeragam ? "#b45309" : "#15803d" },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · PENYAKIT TERBANYAK</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th style={{ width: 260 }}>Diagnosa</th>
                <th style={{ width: 80, textAlign: "center" }}>Kasus</th>
                <th style={{ width: 160 }}>Grafik</th>
                <th>Ditulis juga sebagai</th>
              </tr>
            </thead>
            <tbody>
              {daftarPenyakit.map((d, i) => (
                <tr key={d.nama}>
                  <td style={{ fontSize: 11, color: i < 3 ? "#b45309" : "var(--tm)", fontWeight: i < 3 ? 800 : 400 }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{d.nama}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{d.jumlah}</td>
                  <td>
                    <div style={{ height: 10, borderRadius: 5, background: "var(--posb)", width: `${Math.max(3, (d.jumlah / puncak) * 100)}%` }} />
                  </td>
                  <td style={{ fontSize: 10, color: d.ejaanLain.length ? "#b45309" : "var(--td)" }}>
                    {d.ejaanLain.length ? d.ejaanLain.join(" · ") : "—"}
                  </td>
                </tr>
              ))}
              {daftarPenyakit.length === 0 && (
                <TabelKosong kolom={5} pesan="Belum ada diagnosa tercatat di rentang ini." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Diagnosa yang ditulis dengan huruf besar-kecil atau spasi berbeda digabung jadi satu
          baris; ejaan yang paling sering dipakai yang ditampilkan. Kolom paling kanan memperlihatkan
          ejaan lain yang dipakai untuk penyakit yang sama — itu yang perlu diseragamkan dokter
          supaya statistiknya tidak terpecah.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · KASUS PER JENIS HEWAN</div>
        <table className="tbl" style={{ minWidth: 360 }}>
          <thead><tr><th>Jenis hewan</th><th style={{ width: 100, textAlign: "right" }}>Kasus</th></tr></thead>
          <tbody>
            {perSpesies.map((s) => (
              <tr key={s.nama}>
                <td style={{ fontSize: 11 }}>{s.nama}</td>
                <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{s.n}</td>
              </tr>
            ))}
            {perSpesies.length === 0 && <TabelKosong kolom={2} pesan="Belum ada kasus." />}
          </tbody>
        </table>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>03 · RIWAYAT ANAMNESA</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Tanggal</th>
                <th style={{ width: 130 }}>Pasien</th>
                <th style={{ width: 90 }}>Jenis</th>
                <th style={{ width: 140 }}>Pemilik</th>
                <th style={{ width: 130 }}>Dokter</th>
                <th style={{ width: 150 }}>Cabang</th>
                <th>Anamnesa / keluhan</th>
                <th style={{ width: 190 }}>Diagnosa</th>
              </tr>
            </thead>
            <tbody>
              {disaring.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontSize: 10.5 }}>{tanggalIndo(m.tanggal)}</td>
                  <td style={{ fontSize: 11, fontWeight: 600 }}>{m.pasien}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{m.spesies}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{m.pemilik}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{m.dokter}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{m.cabang}</td>
                  <td style={{ fontSize: 10.5 }}>
                    {m.anamnesis || <span style={{ color: "var(--td)" }}>—</span>}
                    {m.gejala && <div style={{ fontSize: 9.5, color: "var(--td)" }}>gejala: {m.gejala}</div>}
                  </td>
                  <td style={{ fontSize: 10.5, fontWeight: 600, color: m.diagnosis ? "var(--sb)" : "#b45309" }}>
                    {m.diagnosis || "belum diisi"}
                  </td>
                </tr>
              ))}
              {disaring.length === 0 && (
                <TabelKosong kolom={8} pesan="Tidak ada rekam medis yang cocok dengan saringan ini." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Kotak pencarian menyapu diagnosa, anamnesa, dan gejala klinis sekaligus — berguna
          mencari kasus serupa waktu dokter mau membandingkan penanganan.
        </div>
      </div>
    </LaporanPage>
  );
}
