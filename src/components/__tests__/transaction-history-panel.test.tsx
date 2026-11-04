import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransactionHistoryPanel } from "../TransactionHistoryPanel";
import type { HistoryEvent } from "@/lib/transaction-history";

const events: HistoryEvent[] = [
  { key: "a", at: "2026-11-02T03:00:00Z", actor: "Rina Owner", label: "Faktur dikoreksi", detail: ["Faktur FJ-001 → FJ-002", "Kredit pelanggan Rp 15.000"], reason: "Salah harga", tone: "warn" },
  { key: "b", at: "2026-11-01", actor: "Pengguna lain", label: "Faktur dibatalkan", detail: [], reason: null, tone: "danger" },
];

describe("TransactionHistoryPanel", () => {
  it("menampilkan waktu WIB, pelaku, perubahan, detail dan alasan", () => {
    const html = renderToStaticMarkup(<TransactionHistoryPanel title="RIWAYAT PERUBAHAN" events={events} />);
    expect(html).toContain("RIWAYAT PERUBAHAN");
    expect(html).toContain('id="riwayat-perubahan"');
    expect(html).toContain("Rina Owner");
    expect(html).toContain("Faktur dikoreksi");
    expect(html).toContain("Faktur FJ-001 → FJ-002");
    expect(html).toContain("Alasan: Salah harga");
    expect(html).toMatch(/02 Nov 2026,? 10\.00/); // 03:00Z = 10:00 WIB
    expect(html).toContain("01 Nov 2026"); // hanya tanggal, tanpa jam
  });

  it("kosong: pesan jelas, bukan tabel kosong", () => {
    const html = renderToStaticMarkup(<TransactionHistoryPanel title="RIWAYAT" events={[]} />);
    expect(html).toContain("Belum ada perubahan tercatat");
    expect(html).not.toContain("<table");
  });

  it("gagal baca: peringatan terlihat dan data tidak disajikan seolah lengkap", () => {
    const html = renderToStaticMarkup(<TransactionHistoryPanel title="RIWAYAT" events={events} error />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("belum dapat dimuat lengkap");
    expect(html).not.toContain("Belum ada perubahan tercatat");
  });

  it("memberi catatan bila ada pelaku yang namanya tidak terbaca", () => {
    const html = renderToStaticMarkup(<TransactionHistoryPanel title="RIWAYAT" events={events} />);
    expect(html).toContain("Nama pelaku lain hanya terlihat oleh Owner/Admin");
  });

  it("tidak ada catatan nama bila semua pelaku terbaca; teks dari data dilepas (tanpa HTML mentah)", () => {
    const html = renderToStaticMarkup(<TransactionHistoryPanel title="RIWAYAT" events={[{ ...events[0], reason: "<img src=x onerror=1>" }]} />);
    expect(html).not.toContain("Nama pelaku lain");
    expect(html).not.toContain("<img");
  });
});
