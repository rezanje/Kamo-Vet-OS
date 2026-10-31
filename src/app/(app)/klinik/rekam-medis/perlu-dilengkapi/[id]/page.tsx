import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import {
  bacaKartuTertunda, bolehKelolaKartuTertunda, calonIdentitas, hpKartuSah, KartuTertundaGagal, LABEL_KEKURANGAN,
  PESAN_GAGAL_KARTU_TERTUNDA, pilihanTanggal, type CalonIdentitas,
} from "@/lib/kartu-tertunda";
import { batalkanKartuTertunda, lengkapiKartuTertunda } from "../actions";

const tgl = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

/**
 * Satu kartu "Perlu Dilengkapi": isi kartu (baca saja) + formulir melengkapi. Nomor HP adalah patokan pemilik:
 * "Periksa nomor" menampilkan pemilik ber-HP sama; >1 pemilik atau >1 hewan senama wajib dipilih petugas.
 */
export default async function KartuTertundaPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hp?: string; error?: string }>;
}) {
  const { id } = await params;
  const { hp, error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const kembali = <Link href="/klinik/rekam-medis/perlu-dilengkapi" className="back-btn"><i className="ti ti-arrow-left" /> Perlu dilengkapi</Link>;

  let kartu: Awaited<ReturnType<typeof bacaKartuTertunda>> = null;
  let calon: CalonIdentitas | null = null;
  let keadaan: "ok" | "ditolak" | "gagal" = "ok";
  try {
    if (!(await bolehKelolaKartuTertunda(supabase, user?.id))) keadaan = "ditolak";
    else {
      kartu = await bacaKartuTertunda(supabase, id);
      const nomorAwal = kartu ? (hp ?? "").trim() || hpKartuSah(kartu) : null;
      if (kartu?.status === "perlu_dilengkapi" && nomorAwal) calon = await calonIdentitas(supabase, nomorAwal);
    }
  } catch (e) {
    if (!(e instanceof KartuTertundaGagal)) throw e;
    keadaan = "gagal";
  }
  if (keadaan === "ditolak") return <>{kembali}<div role="note" className="p2ban" style={{ marginTop: 8 }}>Halaman ini hanya untuk OWNER/ADMIN aktif.</div></>;
  if (keadaan === "gagal") return <>{kembali}<div role="alert" className="p2ban" style={{ marginTop: 8, background: "#fef2f2", color: "#b91c1c" }}>{PESAN_GAGAL_KARTU_TERTUNDA}</div></>;
  if (!kartu) notFound();
  const k = kartu;
  const isi = k.isi;
  const nomor = (hp ?? "").trim() || hpKartuSah(k) || "";
  const tanggal = pilihanTanggal(isi);
  const butuhTanggal = k.kekurangan.includes("tanggal_bentrok") || k.kekurangan.includes("tanggal_kosong");
  const pemilikSatu = calon && calon.pemilik.length === 1 ? calon.pemilik[0] : null;
  const namaHewan = isi.patient_name ?? "";
  const hewanSenama = pemilikSatu && namaHewan ? calon!.hewanPer(pemilikSatu.id, namaHewan) : [];

  const fields: [string, string | undefined][] = [
    ["Dokter", isi.doctor], ["Keluhan", isi.note], ["Anamnesis", isi.anamnesis], ["Gejala klinis", isi.clinical_findings],
    ["Diagnosis", isi.diagnosis], ["Terapi", isi.therapy],
  ];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>{kembali}</div>
      <div className="pg-hd" style={{ marginBottom: 2 }}>KARTU PERLU DILENGKAPI</div>
      <div className="pg-sub" style={{ marginBottom: 12 }}>
        {isi.patient_name || "Nama hewan kosong"} · {isi.owner_name || "Nama pemilik kosong"} · {isi.phone || "Nomor HP kosong"}
        {[isi.species, isi.breed, isi.gender].filter(Boolean).length ? ` · ${[isi.species, isi.breed, isi.gender].filter(Boolean).join(" · ")}` : ""}
      </div>
      <div style={{ marginBottom: 12 }}>
        {k.kekurangan.map((x) => <span key={x} className="bge" style={{ marginRight: 6 }}>{LABEL_KEKURANGAN[x] ?? x}</span>)}
        <span style={{ fontSize: 11, color: "var(--tm)" }}>{[k.sumber_berkas, k.sumber_sheet].filter(Boolean).join(" · ")}</span>
      </div>
      {error && <div role="alert" className="p2ban" style={{ background: "#fef2f2", color: "#b91c1c", marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "var(--tm)", marginBottom: 6 }}>Tanggal</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
          {tanggal.length ? tanggal.map((t) => `${tgl(t.tanggal)} (${t.label.toLowerCase()})`).join(" · ") : "Tidak ada tanggal di kartu"}
        </div>
        <dl style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "8px 14px", margin: 0, fontSize: 12 }}>
          {fields.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt style={{ fontWeight: 700, color: "var(--tm)" }}>{label}</dt>
              <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{value?.trim() ? value : "—"}</dd>
            </div>
          ))}
        </dl>
      </div>

      {k.status !== "perlu_dilengkapi" ? (
        <div role="note" className="p2ban">
          {k.status === "selesai" ? <>Kartu ini sudah masuk ke riwayat pasien. {k.visit_id && <Link href={`/klinik/rekam-medis/${k.visit_id}`}>Lihat riwayat</Link>}</> : <>Kartu dibatalkan: {k.catatan}</>}
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Lengkapi lalu masukkan ke riwayat</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginBottom: 12 }}>
              Nomor HP adalah patokan pemilik (08… dan +628… dianggap sama). Jangan isi nomor karangan. Pemilik baru otomatis ditandai data lama, jadi tidak dihitung pelanggan baru.
            </div>
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
              <input className="fi" name="hp" defaultValue={nomor} placeholder="Nomor HP pemilik" style={{ width: 220 }} />
              <button className="btn-def" type="submit"><i className="ti ti-search" /> Periksa nomor</button>
              {k.kekurangan.includes("hp_angka") && isi.phone && <span style={{ fontSize: 11, color: "var(--tm)" }}>Nomor di kartu: {isi.phone} (angka 0 di depan hilang — pastikan dulu)</span>}
            </form>
            <form action={lengkapiKartuTertunda} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <input type="hidden" name="id" value={k.id} />
              <input type="hidden" name="phone" value={nomor} />
              {!nomor ? (
                <div style={{ fontSize: 12, color: "var(--tm)" }}>Isi dan periksa nomor HP dulu.</div>
              ) : calon && calon.pemilik.length > 1 ? (
                <fieldset style={{ border: "1px solid var(--bd)", borderRadius: 8, padding: 10 }}>
                  <legend style={{ fontSize: 12, fontWeight: 700 }}>Ada {calon.pemilik.length} pemilik dengan nomor ini — pilih satu</legend>
                  {calon.pemilik.map((c) => (
                    <label key={c.id} style={{ display: "block", fontSize: 12 }}><input type="radio" name="customer_id" value={c.id} required /> {c.name} · {c.phone}</label>
                  ))}
                </fieldset>
              ) : pemilikSatu ? (
                <div style={{ fontSize: 12 }}>Masuk ke pemilik yang sudah ada: <b>{pemilikSatu.name}</b> · {pemilikSatu.phone}</div>
              ) : (
                <div style={{ fontSize: 12 }}>Belum ada pemilik dengan nomor ini — pemilik baru akan dibuat.</div>
              )}
              {nomor && !pemilikSatu && (!calon || calon.pemilik.length === 0) && !isi.owner_name && (
                <label style={{ fontSize: 12 }}>Nama pemilik<input className="fi" name="owner_name" required maxLength={100} style={{ display: "block", width: "100%" }} /></label>
              )}
              {!isi.patient_name && (
                <label style={{ fontSize: 12 }}>Nama hewan<input className="fi" name="patient_name" required maxLength={100} style={{ display: "block", width: "100%" }} /></label>
              )}
              {hewanSenama.length > 1 && (
                <fieldset style={{ border: "1px solid var(--bd)", borderRadius: 8, padding: 10 }}>
                  <legend style={{ fontSize: 12, fontWeight: 700 }}>Ada {hewanSenama.length} hewan bernama sama — pilih satu</legend>
                  {hewanSenama.map((p) => <label key={p.id} style={{ display: "block", fontSize: 12 }}><input type="radio" name="pet_id" value={p.id} required /> {p.name}</label>)}
                </fieldset>
              )}
              <label style={{ fontSize: 12 }}>
                Tanggal pemeriksaan{butuhTanggal ? " (wajib dipilih)" : ""}
                <input className="fi" type="date" name="record_date" required={butuhTanggal} defaultValue={butuhTanggal ? undefined : isi.tanggal_usulan}
                  list={`tanggal-${k.id}`} style={{ display: "block" }} />
                <datalist id={`tanggal-${k.id}`}>{tanggal.map((t) => <option key={t.tanggal} value={t.tanggal}>{t.label}</option>)}</datalist>
              </label>
              {k.kekurangan.includes("kemungkinan_salinan") && (
                <div style={{ fontSize: 11, color: "#b45309" }}>Kartu ini mungkin salinan kartu lain. Kalau memang salinan, batalkan saja di bawah.</div>
              )}
              <div><SubmitButton className="btn-acc" pendingText="Menyimpan…" disabled={!nomor}>Masukkan ke riwayat pasien</SubmitButton></div>
            </form>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Batalkan kartu</div>
            <form action={batalkanKartuTertunda} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="id" value={k.id} />
              <input className="fi" name="alasan" required maxLength={500} placeholder="Alasan (mis. salinan kartu lain)" style={{ width: 320 }} />
              <SubmitButton className="btn-def" pendingText="Membatalkan…">Batalkan</SubmitButton>
            </form>
          </div>
        </>
      )}
    </>
  );
}
