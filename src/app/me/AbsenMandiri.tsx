"use client";

import { useRef, useState, useTransition } from "react";
import { MAKS_FOTO_BYTE, ukuranKompres, type JenisAbsen } from "@/lib/absensi-mandiri";

// C1: absen = selfie (kamera depan) + titik lokasi HP → server.
// Jam tidak dikirim; server yang mencatat jam, mengecek lokasi, dan menolak absen ganda.
// Lokasi yang ditolak/gagal tetap dikirim kosong — server yang memutuskan (cabang tanpa titik boleh).

async function kompresFoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const { lebar, tinggi } = ukuranKompres(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = lebar;
    canvas.height = tinggi;
    const ctx = canvas.getContext("2d");
    if (!ctx || !lebar) throw new Error("canvas");
    ctx.drawImage(bitmap, 0, 0, lebar, tinggi);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.8));
    if (blob && blob.size > 0) return blob;
  } catch {
    // HP lama tanpa createImageBitmap/canvas: kirim aslinya bila memang JPEG dan tidak terlalu besar.
  }
  return file;
}

function ambilLokasi(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => ok({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

export function AbsenMandiri({
  aksi, jenis, label, icon, warna,
}: {
  aksi: (formData: FormData) => void | Promise<void>;
  jenis: JenisAbsen;
  label: string;
  icon: string;
  warna?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tahap, setTahap] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sibuk = pending || tahap !== null;

  const pilihFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setGalat(null);
    setTahap("Menyiapkan foto…");
    const foto = await kompresFoto(file);
    if (foto.size > MAKS_FOTO_BYTE) {
      setTahap(null);
      setGalat("Foto terlalu besar. Coba ambil ulang.");
      return;
    }
    setTahap("Mengambil lokasi…");
    const posisi = await ambilLokasi();
    const fd = new FormData();
    fd.set("jenis", jenis);
    fd.set("foto", new File([foto], "selfie.jpg", { type: "image/jpeg" }));
    if (posisi) {
      fd.set("lat", String(posisi.lat));
      fd.set("lng", String(posisi.lng));
    }
    setTahap("Mengirim absen…");
    startTransition(async () => {
      await aksi(fd);
      setTahap(null);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <input
        ref={inputRef} type="file" accept="image/*" capture="user" hidden
        onChange={pilihFoto} aria-label={`Foto selfie untuk ${label}`}
      />
      <button
        type="button" onClick={() => inputRef.current?.click()} disabled={sibuk}
        className="btn-acc" style={{ background: warna, opacity: sibuk ? 0.7 : 1 }}
      >
        <i className={`ti ${sibuk ? "ti-loader-2" : icon}`} /> {sibuk ? (tahap ?? "Mengirim absen…") : label}
      </button>
      <span style={{ fontSize: 9.5, color: "var(--td)" }}>
        <i className="ti ti-camera" /> Wajib selfie + lokasi di cabang
      </span>
      {galat && <span style={{ fontSize: 10.5, color: "#b91c1c" }}>{galat}</span>}
    </div>
  );
}
