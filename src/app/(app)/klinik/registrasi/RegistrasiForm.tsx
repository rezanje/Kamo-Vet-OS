"use client";

import { STATUS_REPRODUKSI } from "@/lib/anabul";

import { useState } from "react";
import Link from "next/link";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/client";
import { petKosong, MAKS_HEWAN, type PetDraft } from "@/lib/rombongan";
import { registrasiPasien, registrasiDanBayar, lookupPetsByPhone, type PetLite, type CustomerLite } from "./actions";

function SubHead({ icon, title, color, tint }: { icon: string; title: string; color: string; tint: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px" }}>
      <div style={{ width: 26, height: 26, borderRadius: 7, background: tint, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`ti ${icon}`} style={{ fontSize: 15 }} />
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color, letterSpacing: ".02em" }}>{title}</div>
    </div>
  );
}

const req = <span style={{ color: "#dc2626" }}>*</span>;

// Anabul lama dari lookup no. HP → draft siap diisi (keluhan selalu mulai kosong,
// itu milik kunjungan hari ini, bukan data hewannya).
const dariPetLama = (p: PetLite): PetDraft => ({
  ...petKosong(),
  id: p.id,
  name: p.name,
  species: p.species ?? "Anjing",
  breed: p.breed ?? "",
  warna: p.warna ?? "",
  dob: p.dob ?? "",
  gender: p.gender ?? "Jantan",
  weight: p.weight,
  sterilisasi: p.sterilisasi ?? "Utuh",
  microchip: p.microchip ?? "",
  alergi: p.alergi ?? "",
  kondisi_khusus: p.kondisi_khusus ?? "",
  golongan_darah: p.golongan_darah ?? "",
  photo_url: p.photo_url ?? "",
});

export function RegistrasiForm({ branches, dokter = [], lockBranch = false, awal }: {
  branches: { id: string; name: string }[];
  dokter?: { id: string; nama: string; jabatan: string | null; jaga?: boolean }[];
  lockBranch?: boolean;
  /** Isian awal dari booking online — staf tinggal melengkapi, tidak mengetik ulang. */
  awal?: {
    bookingId: string; phone: string; nama: string; branchId: string; poli: string;
    namaHewan: string; jenisHewan: string; keluhan: string;
  };
}) {
  const [phone, setPhone] = useState(awal?.phone ?? "");
  const [looking, setLooking] = useState(false);
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [existingPets, setExistingPets] = useState<PetLite[]>([]);
  // Satu pemilik boleh membawa beberapa hewan sekaligus; tiap hewan satu tab.
  const [pets, setPets] = useState<PetDraft[]>([
    awal
      ? { ...petKosong(), name: awal.namaHewan, species: awal.jenisHewan, keluhan: awal.keluhan }
      : petKosong(),
  ]);
  const [aktif, setAktif] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  const pet = pets[aktif] ?? petKosong();
  const setPet = (patch: Partial<PetDraft>) =>
    setPets((ps) => ps.map((p, i) => (i === aktif ? { ...p, ...patch } : p)));

  // Anabul yang sudah dipilih di tab lain tidak ditawarkan lagi — memilihnya dua
  // kali berarti dua kunjungan menumpuk di satu hewan.
  const sudahDipilih = new Set(pets.map((p, i) => (i === aktif ? "" : p.id)).filter(Boolean));

  const tambahHewan = () => {
    setPets((ps) => [...ps, petKosong()]);
    setAktif(pets.length);
  };

  const hapusHewan = (i: number) => {
    if (pets.length <= 1) return;
    setPets((ps) => ps.filter((_, j) => j !== i));
    setAktif((a) => (a >= i && a > 0 ? a - 1 : a));
  };

  async function onPhoneBlur() {
    const p = phone.trim();
    if (p.length < 6) return;
    setLooking(true);
    try {
      const res = await lookupPetsByPhone(p);
      setCustomer(res.customer);
      setExistingPets(res.pets);
    } finally {
      setLooking(false);
    }
  }

  function pickExistingPet(id: string) {
    if (!id) {
      setPet(petKosong());
      return;
    }
    const found = existingPets.find((p) => p.id === id);
    if (found) setPet(dariPetLama(found));
  }

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const sementara = URL.createObjectURL(file);
    setPet({ photo_url: sementara });
    setUploading(true);
    setUploadErr("");
    try {
      const supabase = createClient();
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "-")}`;
      const { error } = await supabase.storage.from("pet-photos").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("pet-photos").getPublicUrl(path);
      setPet({ photo_url: data.publicUrl });
    } catch (err) {
      // Pratinjau sementara tidak boleh ikut tersimpan — URL blob mati begitu halaman ditutup.
      setPet({ photo_url: "" });
      setUploadErr(err instanceof Error ? err.message : "Gagal upload foto");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={registrasiPasien}>
      <input type="hidden" name="pets" value={JSON.stringify(pets)} />
      {awal && <input type="hidden" name="bookingId" value={awal.bookingId} />}

      <div className="grid2">
        {/* ================= KIRI: pemilik + kunjungan + keluhan ================= */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="DATA PEMILIK" desc="Data pelanggan / pemilik anabul." />
          <div className="fg">
            <label className="flab">Nomor HP {req}</label>
            <input
              className="fi" name="phone" placeholder="081234567890" required
              value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={onPhoneBlur}
            />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              {looking ? "Mencari pelanggan…" : customer
                ? `Pelanggan terdaftar: ${customer.name}${existingPets.length ? ` · ${existingPets.length} anabul ditemukan` : ""}`
                : "Kalau nomor sudah terdaftar, data pelanggan lama otomatis dipakai."}
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Nama lengkap {req}</label>
              <input className="fi" name="name" placeholder="Susi" defaultValue={customer?.name ?? awal?.nama ?? ""} key={customer?.id ?? "new"} required />
            </div>
            <div>
              <label className="flab">
                Tgl lahir <span style={{ color: "var(--acc)" }} title="Untuk WA birthday trigger">★WA</span>
              </label>
              <input className="fi" name="dob" type="date" defaultValue={customer?.dob ?? ""} key={`dob-${customer?.id ?? "new"}`} />
            </div>
          </div>
          <div className="fg">
            <label className="flab">Email</label>
            <input className="fi" name="email" type="email" placeholder="susi@gmail.com" defaultValue={customer?.email ?? ""} key={`email-${customer?.id ?? "new"}`} />
          </div>
          <div>
            <label className="flab">Alamat</label>
            <input className="fi" name="address" placeholder="Jl. Merdeka No. 10, Bogor" defaultValue={customer?.address ?? ""} key={`addr-${customer?.id ?? "new"}`} />
          </div>

          <div style={{ borderTop: ".5px dashed var(--bd)", margin: "14px 0 0", paddingTop: 4 }} />
          <SubHead icon="ti-calendar-event" title="DATA KUNJUNGAN" color="#2563eb" tint="#eff6ff" />
          <div className="frow">
            <div>
              <label className="flab">Cabang {req}</label>
              {lockBranch && branches[0] ? (
                <>
                  <input className="fi" value={branches[0].name} disabled style={{ background: "var(--sf1)", color: "var(--tm)" }} />
                  <input type="hidden" name="branchId" value={branches[0].id} />
                </>
              ) : (
                <select className="fi" name="branchId" required defaultValue={awal?.branchId ?? ""}>
                  <option value="" disabled>Pilih cabang</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="flab">Poli tujuan {req}</label>
              <select className="fi" name="poli" defaultValue={awal?.poli ?? "Poli Umum"}>
                <option>Poli Umum</option>
                <option>Poli Gigi</option>
                <option>Poli Kulit</option>
                <option>Vaksinasi</option>
                <option>Grooming</option>
              </select>
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Dokter</label>
              <select className="fi" name="doctor_id" defaultValue="">
                <option value="">— belum ditentukan —</option>
                {dokter.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nama}{d.jabatan ? ` · ${d.jabatan}` : ""}{d.jaga ? " · jaga hari ini" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="flab">Jenis kunjungan</label>
              <select className="fi" name="kontrol" defaultValue="baru">
                <option value="baru">Kunjungan baru</option>
                <option value="ulang">Kontrol / ulang</option>
              </select>
            </div>
          </div>
          <div>
            <label className="flab">Tujuan kontrol (jika kontrol)</label>
            <input className="fi" name="tujuanKontrol" placeholder="Kontrol jahitan" />
          </div>

          <div style={{ borderTop: ".5px dashed var(--bd)", margin: "14px 0 0", paddingTop: 4 }} />
          <div style={{ fontSize: 10, color: "var(--td)", lineHeight: 1.7 }}>
            <i className="ti ti-info-circle" /> Cabang, poli, dokter, dan jenis kunjungan berlaku
            untuk semua hewan yang didaftarkan. Keluhan diisi per hewan di panel sebelah.
          </div>
        </div>

        {/* ================= KANAN: anabul + riwayat + catatan ================= */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader
            num="02" title="DATA PASIEN (HEWAN)"
            desc={pets.length > 1
              ? `${pets.length} hewan didaftarkan sekaligus — tiap hewan dapat nomor antrian & rekam medis sendiri.`
              : "Data hewan peliharaan yang akan diperiksa."}
          />

          {/* Satu tab per hewan. Kunjungan tetap dipisah di belakang layar; yang
              digabung cuma pendaftarannya supaya data pemilik diisi sekali. */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 12, borderBottom: ".5px solid var(--bd)", paddingBottom: 8 }}>
            {pets.map((p, i) => (
              <div key={i} style={tabHewan(i === aktif)}>
                <button type="button" onClick={() => setAktif(i)}
                  style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>
                  <i className="ti ti-paw" style={{ marginRight: 4, fontSize: 12 }} />
                  {p.name.trim() || `Hewan ${i + 1}`}
                </button>
                {pets.length > 1 && (
                  <button type="button" onClick={() => hapusHewan(i)} title="Hapus hewan ini"
                    style={{ background: "none", border: "none", padding: "0 0 0 6px", cursor: "pointer", color: "inherit", opacity: 0.6, font: "inherit" }}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {pets.length < MAKS_HEWAN && (
              <button type="button" onClick={tambahHewan} className="btn-def"
                style={{ padding: "4px 10px", fontSize: 11 }} title="Tambah hewan lain milik pemilik yang sama">
                <i className="ti ti-plus" /> Tambah hewan
              </button>
            )}
          </div>

          {existingPets.length > 0 && (
            <div className="fg">
              <label className="flab">Anabul terdaftar</label>
              <select className="fi" onChange={(e) => pickExistingPet(e.target.value)} value={pet.id}>
                <option value="">+ Anabul baru</option>
                {existingPets.filter((p) => !sudahDipilih.has(p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.species}{p.breed ? ` (${p.breed})` : ""}</option>
                ))}
              </select>
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Pilih buat panggil data anabul lama, atau daftarkan anabul baru untuk pelanggan ini.
                Anabul yang sudah dipilih di tab lain tidak muncul di sini.
              </div>
            </div>
          )}

          <div className="fg" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 10, background: "var(--sf1)", border: ".5px solid var(--bd)",
              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
            }}>
              {pet.photo_url
                ? <img src={pet.photo_url} alt="Foto anabul" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <i className="ti ti-paw" style={{ fontSize: 24, color: "var(--td)" }} />}
            </div>
            <div>
              <label className="btn-def" style={{ cursor: "pointer", display: "inline-flex" }}>
                <i className="ti ti-camera" style={{ marginRight: 4 }} /> {uploading ? "Mengunggah…" : "Ubah foto"}
                <input type="file" accept="image/*" onChange={onPhotoChange} style={{ display: "none" }} disabled={uploading} />
              </label>
              <div style={{ fontSize: 9.5, color: uploadErr ? "#dc2626" : "var(--td)", marginTop: 4 }}>
                {uploadErr || "Format JPG/PNG, maks. 2MB."}
              </div>
            </div>
          </div>

          <div className="frow">
            <div>
              <label className="flab">Nama hewan {req}</label>
              <input className="fi" placeholder="Choco" value={pet.name} onChange={(e) => setPet({ name: e.target.value })} />
            </div>
            <div>
              <label className="flab">Jenis hewan {req}</label>
              <select className="fi" value={pet.species} onChange={(e) => setPet({ species: e.target.value })}>
                <option>Anjing</option>
                <option>Kucing</option>
                <option>Kelinci</option>
                <option>Burung</option>
                <option>Lainnya</option>
              </select>
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Ras</label>
              <input className="fi" placeholder="Golden Retriever" value={pet.breed} onChange={(e) => setPet({ breed: e.target.value })} />
            </div>
            <div>
              <label className="flab">Warna / ciri-ciri</label>
              <input className="fi" placeholder="Cokelat keemasan" value={pet.warna} onChange={(e) => setPet({ warna: e.target.value })} />
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Jenis kelamin</label>
              <select className="fi" value={pet.gender} onChange={(e) => setPet({ gender: e.target.value })}>
                <option>Jantan</option>
                <option>Betina</option>
              </select>
            </div>
            <div>
              <label className="flab">Berat badan (kg)</label>
              <input className="fi" type="number" step="0.1" min={0} placeholder="12.5" value={pet.weight ?? ""} onChange={(e) => setPet({ weight: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Tgl lahir</label>
              <input className="fi" type="date" value={pet.dob} onChange={(e) => setPet({ dob: e.target.value })} />
            </div>
            <div>
              <label className="flab">Status reproduksi</label>
              <select className="fi" value={pet.sterilisasi} onChange={(e) => setPet({ sterilisasi: e.target.value })}>
                {STATUS_REPRODUKSI.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">No. microchip (jika ada)</label>
              <input className="fi" placeholder="—" value={pet.microchip} onChange={(e) => setPet({ microchip: e.target.value })} />
            </div>
            <div>
              <label className="flab">Golongan darah</label>
              <input className="fi" placeholder="DEA 1.1" value={pet.golongan_darah} onChange={(e) => setPet({ golongan_darah: e.target.value })} />
            </div>
          </div>

          <div style={{ background: "#f0fdf4", border: ".5px solid #bbf7d0", borderRadius: 10, padding: 12, marginTop: 12 }}>
            <SubHead icon="ti-heartbeat" title="RIWAYAT KESEHATAN SINGKAT" color="#16a34a" tint="#dcfce7" />
            <div className="frow">
              <div>
                <label className="flab">Alergi</label>
                <input className="fi" placeholder="Tidak ada" value={pet.alergi} onChange={(e) => setPet({ alergi: e.target.value })} />
              </div>
              <div>
                <label className="flab">Penyakit / kondisi khusus</label>
                <input className="fi" placeholder="—" value={pet.kondisi_khusus} onChange={(e) => setPet({ kondisi_khusus: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Keluhan dipegang per hewan: tiga kucing satu pemilik bisa datang
              dengan tiga masalah yang sama sekali berbeda. */}
          <div style={{ background: "#f3f0ff", border: ".5px solid #ddd6fe", borderRadius: 10, padding: 12, marginTop: 12 }}>
            <SubHead icon="ti-clipboard-text" title="KELUHAN UTAMA" color="#7c3aed" tint="#ede9fe" />
            <textarea className="fi" rows={2} placeholder="Batuk, nafsu makan turun"
              value={pet.keluhan} onChange={(e) => setPet({ keluhan: e.target.value })}
              style={{ resize: "vertical" }} />
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
              Keluhan {pet.name.trim() || `hewan ${aktif + 1}`}, bukan keluhan seluruh rombongan.
            </div>
          </div>

          <div style={{ background: "#fffbeb", border: ".5px solid #fde68a", borderRadius: 10, padding: 12, marginTop: 12 }}>
            <SubHead icon="ti-paperclip" title="DOKUMEN / CATATAN TAMBAHAN" color="#d97706" tint="#fef3c7" />
            <textarea className="fi" name="catatan" rows={2} placeholder="Pasien baru, belum pernah berobat di klinik ini." style={{ resize: "vertical" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 12 }}>
        {pets.length > 1 && (
          <span style={{ fontSize: 11, color: "var(--tm)", marginRight: "auto" }}>
            <i className="ti ti-paw" /> {pets.length} hewan akan didaftarkan — nomor antriannya berurutan.
          </span>
        )}
        <Link href="/klinik" className="btn-def">Batal</Link>
        <SubmitButton className="btn-acc" style={{ fontWeight: 600 }} pendingText="Menyimpan…">Simpan pendaftaran</SubmitButton>
        <SubmitButton className="btn-acc" icon="ti-cash" formAction={registrasiDanBayar} pendingText="Memproses…">Simpan &amp; pembayaran</SubmitButton>
      </div>
    </form>
  );
}

function tabHewan(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center",
    padding: "5px 10px", borderRadius: 7, fontSize: 11.5, fontWeight: 600,
    background: active ? "#eff6ff" : "var(--sf1)",
    color: active ? "#2563eb" : "var(--tm)",
    border: `.5px solid ${active ? "#bfdbfe" : "var(--bd)"}`,
  };
}
