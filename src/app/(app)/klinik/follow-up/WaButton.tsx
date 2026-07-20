"use client";

// Buka WhatsApp di tab baru sekaligus tandai "Terkirim" — satu klik, biar staff
// gak perlu ingat menandai manual setelah pesannya dikirim.
export function WaButton({ href }: { href: string }) {
  return (
    <button
      type="submit"
      className="btn-acc"
      style={{ padding: "3px 9px", fontSize: 10.5, background: "#16a34a" }}
      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
    >
      <i className="ti ti-brand-whatsapp" /> Kirim WA
    </button>
  );
}
