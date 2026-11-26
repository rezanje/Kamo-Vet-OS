"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { KopCabang } from "@/components/KopCabang";

export type KlinikBooking = { id: string; name: string; alamat?: string | null; telepon?: string | null };

const Konteks = createContext<{ pilihan: string; setPilihan: (id: string) => void; klinik: KlinikBooking[] }>({ pilihan: "", setPilihan: () => {}, klinik: [] });

/**
 * Halaman booking publik: kop mengikuti KLINIK yang dipilih pengunjung (atau `awal` dari tautan ?cabang=).
 * Belum ada klinik terpilih = kop umum lama (teks "KAMO PET CARE"). Logo cabang tidak tampil di halaman publik:
 * berkas logo ada di bucket privat dan pengunjung tanpa login tidak bisa membuat tautannya; yang tampil logo cakar bawaan.
 */
export function BookingKlinikProvider({ klinik, awal, children }: { klinik: KlinikBooking[]; awal: string; children: ReactNode }) {
  const [pilihan, setPilihan] = useState(klinik.some((k) => k.id === awal) ? awal : "");
  return <Konteks.Provider value={{ pilihan, setPilihan, klinik }}>{children}</Konteks.Provider>;
}

export function BookingKop() {
  const { pilihan, klinik } = useContext(Konteks);
  const k = klinik.find((x) => x.id === pilihan) ?? null;
  return (
    <div data-booking-kop style={{ textAlign: "center", marginBottom: 18 }}>
      {k ? (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <KopCabang nama={k.name} alamat={k.alamat} telepon={k.telepon} logoUrl={null} ukuranNama={22} warnaNama="#1e3a8a" ukuranKontak={11} />
        </div>
      ) : (
        <div style={{ fontSize: 22, fontWeight: 800, color: "#1e3a8a" }}>KAMO PET CARE</div>
      )}
      <div style={{ fontSize: 13, color: "#4b5563", marginTop: 6 }}>
        Booking jadwal periksa hewan kesayangan
      </div>
    </div>
  );
}

export function PilihKlinikBooking() {
  const { pilihan, setPilihan, klinik } = useContext(Konteks);
  return (
    <select className="fi" name="branch_id" required value={pilihan} onChange={(e) => setPilihan(e.target.value)}>
      <option value="" disabled>— pilih klinik —</option>
      {klinik.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}
