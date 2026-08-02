"use client";

import { useRef, useState } from "react";

// Tombol absen yang mengambil titik lokasi HP dulu, baru mengirim.
// Kalau lokasi ditolak/gagal, form tetap dikirim tanpa koordinat — server yang
// memutuskan: cabang tanpa titik tetap boleh absen, cabang bertitik akan menolak
// dengan pesan yang jelas. Keputusan tidak boleh ada di sisi HP.
export function AbsenTombol({
  aksi, label, icon, warna,
}: {
  aksi: (formData: FormData) => void | Promise<void>;
  label: string;
  icon: string;
  warna?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [sibuk, setSibuk] = useState(false);

  const kirim = () => {
    if (sibuk) return;
    setSibuk(true);

    const lanjut = () => formRef.current?.requestSubmit();

    if (!navigator.geolocation) return lanjut();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current) latRef.current.value = String(pos.coords.latitude);
        if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
        lanjut();
      },
      () => lanjut(),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  };

  return (
    <form action={aksi} ref={formRef}>
      <input type="hidden" name="lat" ref={latRef} />
      <input type="hidden" name="lng" ref={lngRef} />
      <button
        type="button" onClick={kirim} disabled={sibuk}
        className="btn-acc" style={{ background: warna, opacity: sibuk ? 0.7 : 1 }}
      >
        <i className={`ti ${sibuk ? "ti-loader-2" : icon}`} /> {sibuk ? "Mengambil lokasi…" : label}
      </button>
    </form>
  );
}
