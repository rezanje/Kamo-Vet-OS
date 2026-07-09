"use client";

import { useState } from "react";
import Link from "next/link";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/client";
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
const emptyPet: PetLite = {
  id: "", name: "", species: "Anjing", breed: "", warna: "", dob: "", gender: "Jantan", weight: null,
  sterilisasi: "Utuh", microchip: "", alergi: "", kondisi_khusus: "", golongan_darah: "", photo_url: "",
};

export function RegistrasiForm({ branches, lockBranch = false }: { branches: { id: string; name: string }[]; lockBranch?: boolean }) {
  const [phone, setPhone] = useState("");
  const [looking, setLooking] = useState(false);
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [existingPets, setExistingPets] = useState<PetLite[]>([]);
  const [pet, setPet] = useState<PetLite>(emptyPet);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

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
      setPet(emptyPet);
      setPhotoPreview(null);
      return;
    }
    const found = existingPets.find((p) => p.id === id);
    if (found) {
      setPet(found);
      setPhotoPreview(found.photo_url || null);
    }
  }

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setUploading(true);
    setUploadErr("");
    try {
      const supabase = createClient();
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "-")}`;
      const { error } = await supabase.storage.from("pet-photos").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("pet-photos").getPublicUrl(path);
      setPet((p) => ({ ...p, photo_url: data.publicUrl }));
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "Gagal upload foto");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={registrasiPasien}>
      <input type="hidden" name="petId" value={pet.id} />
      <input type="hidden" name="photoUrl" value={pet.photo_url ?? ""} />

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
              <input className="fi" name="name" placeholder="Susi" defaultValue={customer?.name ?? ""} key={customer?.id ?? "new"} required />
            </div>
            <div>
              <label className="flab">
                Tgl lahir <span style={{ color: "var(--acc)" }} title="Untuk WA birthday trigger">★WA</span>
              </label>
              <input className="fi" name="dob" type="date" defaultValue={customer?.dob ?? ""} key={`dob-${customer?.id ?? "new"}`} />
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Email</label>
              <input className="fi" name="email" type="email" placeholder="susi@gmail.com" defaultValue={customer?.email ?? ""} key={`email-${customer?.id ?? "new"}`} />
            </div>
            <div>
              <label className="flab">Kategori pelanggan</label>
              <select className="fi" name="tier" defaultValue={customer?.tier ?? "New"} key={`tier-${customer?.id ?? "new"}`}>
                <option value="New">Baru</option>
                <option value="Silver">Silver</option>
                <option value="Gold">Gold</option>
                <option value="Platinum">Platinum</option>
              </select>
            </div>
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
                <select className="fi" name="branchId" required defaultValue="">
                  <option value="" disabled>Pilih cabang</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="flab">Poli tujuan {req}</label>
              <select className="fi" name="poli">
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
              <input className="fi" name="dokter" placeholder="Drh. Rena" />
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
          <SubHead icon="ti-clipboard-text" title="KELUHAN UTAMA" color="#7c3aed" tint="#f3f0ff" />
          <div>
            <textarea className="fi" name="keluhan" rows={2} placeholder="Batuk, nafsu makan turun" style={{ resize: "vertical" }} />
          </div>
        </div>

        {/* ================= KANAN: anabul + riwayat + catatan ================= */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="DATA PASIEN (HEWAN)" desc="Data hewan peliharaan yang akan diperiksa." />

          {existingPets.length > 0 && (
            <div className="fg">
              <label className="flab">Anabul terdaftar</label>
              <select className="fi" onChange={(e) => pickExistingPet(e.target.value)} defaultValue="">
                <option value="">+ Anabul baru</option>
                {existingPets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.species}{p.breed ? ` (${p.breed})` : ""}</option>
                ))}
              </select>
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>Pilih buat panggil data anabul lama, atau daftarkan anabul baru untuk pelanggan ini.</div>
            </div>
          )}

          <div className="fg" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 10, background: "var(--sf1)", border: ".5px solid var(--bd)",
              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
            }}>
              {photoPreview
                ? <img src={photoPreview} alt="Foto anabul" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
              <input className="fi" name="petName" placeholder="Choco" value={pet.name} onChange={(e) => setPet({ ...pet, name: e.target.value })} required />
            </div>
            <div>
              <label className="flab">Jenis hewan {req}</label>
              <select className="fi" name="species" value={pet.species ?? "Anjing"} onChange={(e) => setPet({ ...pet, species: e.target.value })} required>
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
              <input className="fi" name="breed" placeholder="Golden Retriever" value={pet.breed ?? ""} onChange={(e) => setPet({ ...pet, breed: e.target.value })} />
            </div>
            <div>
              <label className="flab">Warna / ciri-ciri</label>
              <input className="fi" name="warna" placeholder="Cokelat keemasan" value={pet.warna ?? ""} onChange={(e) => setPet({ ...pet, warna: e.target.value })} />
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Jenis kelamin</label>
              <select className="fi" name="gender" value={pet.gender ?? "Jantan"} onChange={(e) => setPet({ ...pet, gender: e.target.value })}>
                <option>Jantan</option>
                <option>Betina</option>
              </select>
            </div>
            <div>
              <label className="flab">Berat badan (kg)</label>
              <input className="fi" name="weight" type="number" step="0.1" placeholder="12.5" value={pet.weight ?? ""} onChange={(e) => setPet({ ...pet, weight: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">Tgl lahir</label>
              <input className="fi" name="petDob" type="date" value={pet.dob ?? ""} onChange={(e) => setPet({ ...pet, dob: e.target.value })} />
            </div>
            <div>
              <label className="flab">Status reproduksi</label>
              <select className="fi" name="sterilisasi" value={pet.sterilisasi ?? "Utuh"} onChange={(e) => setPet({ ...pet, sterilisasi: e.target.value })}>
                <option>Utuh</option>
                <option>Steril</option>
              </select>
            </div>
          </div>
          <div className="frow">
            <div>
              <label className="flab">No. microchip (jika ada)</label>
              <input className="fi" name="microchip" placeholder="—" value={pet.microchip ?? ""} onChange={(e) => setPet({ ...pet, microchip: e.target.value })} />
            </div>
            <div>
              <label className="flab">Golongan darah</label>
              <input className="fi" name="golongan_darah" placeholder="DEA 1.1" value={pet.golongan_darah ?? ""} onChange={(e) => setPet({ ...pet, golongan_darah: e.target.value })} />
            </div>
          </div>

          <div style={{ background: "#f0fdf4", border: ".5px solid #bbf7d0", borderRadius: 10, padding: 12, marginTop: 12 }}>
            <SubHead icon="ti-heartbeat" title="RIWAYAT KESEHATAN SINGKAT" color="#16a34a" tint="#dcfce7" />
            <div className="frow">
              <div>
                <label className="flab">Alergi</label>
                <input className="fi" name="alergi" placeholder="Tidak ada" value={pet.alergi ?? ""} onChange={(e) => setPet({ ...pet, alergi: e.target.value })} />
              </div>
              <div>
                <label className="flab">Penyakit / kondisi khusus</label>
                <input className="fi" name="kondisi_khusus" placeholder="—" value={pet.kondisi_khusus ?? ""} onChange={(e) => setPet({ ...pet, kondisi_khusus: e.target.value })} />
              </div>
            </div>
          </div>

          <div style={{ background: "#fffbeb", border: ".5px solid #fde68a", borderRadius: 10, padding: 12, marginTop: 12 }}>
            <SubHead icon="ti-paperclip" title="DOKUMEN / CATATAN TAMBAHAN" color="#d97706" tint="#fef3c7" />
            <textarea className="fi" name="catatan" rows={2} placeholder="Pasien baru, belum pernah berobat di klinik ini." style={{ resize: "vertical" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 12 }}>
        <Link href="/klinik" className="btn-def">Batal</Link>
        <SubmitButton className="btn-def" style={{ fontWeight: 600 }} pendingText="Menyimpan…">Simpan pendaftaran</SubmitButton>
        <SubmitButton className="btn-acc" icon="ti-cash" formAction={registrasiDanBayar} pendingText="Memproses…">Simpan &amp; pembayaran</SubmitButton>
      </div>
    </form>
  );
}
