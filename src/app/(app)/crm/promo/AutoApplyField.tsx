"use client";
import { useEffect, useRef } from "react";

export const PESAN_PENGINGAT_SAJA =
  'Promo ini disimpan sebagai "Pengingat saja".\n\n' +
  "Artinya kasir HANYA melihat saran di layar — tidak ada potongan yang masuk ke total, " +
  "kecuali pelanggan menyebut kode kampanye yang ditautkan ke promo ini.\n\n" +
  'Centang "Potong otomatis di kasir" kalau potongannya memang harus langsung terhitung sendiri.\n\n' +
  "Lanjut simpan sebagai pengingat saja?";

/**
 * Kotak centang "potong otomatis" + konfirmasi saat promo disimpan TANPA-nya.
 *
 * "Pengingat saja" dan "potong otomatis" selama ini cuma dibedakan oleh satu
 * kotak centang kecil, dan akibatnya baru kelihatan di kasir: yang satu
 * mengurangi uang sendiri, yang satu tidak mengurangi apa pun. Konfirmasi ini
 * memaksa bedanya dibaca sekali sebelum promo tanpa potong otomatis disimpan.
 *
 * Penyadapnya dipasang pada fase capture di elemen <form>-nya sendiri supaya
 * berjalan sebelum penangan form action milik React (yang terpasang di akar
 * dokumen); stopImmediatePropagation menahan aksinya ketika pengguna membatalkan.
 */
export function AutoApplyField({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const konfirmasi = (event: Event) => {
      if (ref.current?.checked) return;
      if (!window.confirm(PESAN_PENGINGAT_SAJA)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    form.addEventListener("submit", konfirmasi, true);
    return () => form.removeEventListener("submit", konfirmasi, true);
  }, []);

  return (
    <div style={{ gridColumn: "1 / -1", background: "#f8fafc", border: ".5px solid var(--bd)", borderRadius: 7, padding: "9px 11px" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700 }}>
        <input ref={ref} type="checkbox" name="auto_apply" value="1" defaultChecked={defaultChecked} /> Potong otomatis di kasir
      </label>
      <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
        Dicentang: potongan langsung masuk keranjang, kasir tidak perlu mengetik apa pun —
        butuh jenis & nilai diskon terisi. Tidak dicentang: promo cuma muncul sebagai pengingat
        di layar kasir dan TIDAK memotong, kecuali pelanggan memakai kode kampanye yang ditautkan.
      </div>
    </div>
  );
}
