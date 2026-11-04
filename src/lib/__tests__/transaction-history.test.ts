import { describe, expect, it } from "vitest";
import {
  actorLabel, bolehLihatRiwayat, fakturHistory, klinikHistory, petshopHistory, sortHistory, type HistoryEvent,
} from "../transaction-history";

const names = new Map([["u-owner", "Rina Owner"], ["u-fin", "Fajar Finance"]]);

describe("bolehLihatRiwayat", () => {
  it.each(["OWNER", "ADMIN", "FINANCE"])("%s aktif boleh", (role) => {
    expect(bolehLihatRiwayat({ role, is_active: true })).toBe(true);
  });
  it("peran lain, akun nonaktif dan tanpa profil ditolak", () => {
    expect(bolehLihatRiwayat({ role: "STAFF", is_active: true })).toBe(false);
    expect(bolehLihatRiwayat({ role: "KASIR", is_active: true })).toBe(false);
    expect(bolehLihatRiwayat({ role: "OWNER", is_active: false })).toBe(false);
    expect(bolehLihatRiwayat(null)).toBe(false);
  });
});

describe("actorLabel", () => {
  it("memakai nama bila diketahui", () => expect(actorLabel("u-owner", names, "u-fin")).toBe("Rina Owner"));
  it("pelaku sendiri tanpa nama tersimpan menjadi Anda", () => expect(actorLabel("u-x", names, "u-x")).toBe("Anda"));
  it("pelaku lain yang namanya tidak terbaca tidak menampilkan UUID", () => {
    const label = actorLabel("0c1e2f3a-aaaa-bbbb-cccc-000000000000", names, "u-fin");
    expect(label).toBe("Pengguna lain");
    expect(label).not.toMatch(/[0-9a-f]{8}-/);
  });
  it("tanpa id = tidak tercatat", () => expect(actorLabel(null, names, "u-fin")).toBe("Tidak tercatat"));
});

describe("sortHistory", () => {
  const ev = (key: string, at: string | null): HistoryEvent => ({ key, at, actor: "x", label: key, detail: [], reason: null, tone: "info" });
  it("terbaru dulu, tanggal saja dihitung, tanpa waktu paling bawah, urutan stabil", () => {
    const sorted = sortHistory([ev("a", "2026-11-01T01:00:00Z"), ev("b", null), ev("c", "2026-11-03"), ev("d", "2026-11-01T01:00:00Z")]);
    expect(sorted.map((e) => e.key)).toEqual(["c", "a", "d", "b"]);
  });
  it("tidak mengubah array masukan", () => {
    const input = [ev("a", "2026-11-01"), ev("b", "2026-11-02")];
    sortHistory(input);
    expect(input.map((e) => e.key)).toEqual(["a", "b"]);
  });
});

describe("fakturHistory", () => {
  const invoices = [
    { id: "inv-old", no_faktur: "FJ-001", status: "batal", replaces_invoice_id: null, voided_on: "2026-11-02", void_reason: "Salah harga" },
    { id: "inv-new", no_faktur: "FJ-002", status: "berjalan", replaces_invoice_id: "inv-old", voided_on: null, void_reason: null },
    { id: "inv-gone", no_faktur: "FJ-009", status: "batal", replaces_invoice_id: null, voided_on: "2026-10-30", void_reason: "Dobel input" },
  ];
  const input = {
    viewerId: "u-fin", names, invoices,
    corrections: [{ id: "c1", invoice_id: "inv-old", created_at: "2026-11-02T03:00:00Z", tanggal: "2026-11-02", reason: "Salah harga",
      created_by: "u-owner", paid_preserved: 0, customer_credit: 15000, original_journal_id: "aaaaaaaa-1111", reversal_journal_id: "bbbbbbbb-2222", replacement_journal_id: "cccccccc-3333", credit_journal_id: null }],
    cancellations: [{ id: "x1", receipt_id: "r1", invoice_id: "inv-old", created_at: "2026-11-02T02:00:00Z", tanggal: "2026-11-02", reason: "Salah nominal",
      created_by: "u-fin", advance_restored: 5000, original_journal_id: "dddddddd-4444", reversal_journal_id: "eeeeeeee-5555" }],
    receipts: [{ id: "r1", invoice_id: "inv-old", no_terima: "TRM-7", jumlah: 100000, tanggal: "2026-11-01", metode: "Transfer", voided_at: "2026-11-02T02:00:00Z", void_reason: "Salah nominal", reversal_of: null }],
  };

  it("menyusun koreksi dan hapus penerimaan: siapa, kapan, apa, alasan, nomor lama ke baru", () => {
    const events = fakturHistory(input);
    const koreksi = events.find((e) => e.key === "koreksi:c1")!;
    expect(koreksi.actor).toBe("Rina Owner");
    expect(koreksi.at).toBe("2026-11-02T03:00:00Z");
    expect(koreksi.reason).toBe("Salah harga");
    expect(koreksi.detail.join(" | ")).toContain("FJ-001 → FJ-002");
    expect(koreksi.detail.join(" | ")).toContain("Kredit pelanggan Rp 15.000");
    const hapus = events.find((e) => e.key === "hapus-penerimaan:x1")!;
    expect(hapus.actor).toBe("Fajar Finance");
    expect(hapus.label).toBe("Penerimaan dihapus");
    expect(hapus.detail.join(" | ")).toContain("TRM-7");
    expect(hapus.detail.join(" | ")).toContain("Transfer");
    expect(hapus.detail.join(" | ")).toContain("Rp 100.000");
    expect(hapus.detail.join(" | ")).toContain("Uang muka dikembalikan Rp 5.000");
  });

  it("urutan terbaru dulu dan faktur batal tanpa koreksi tetap muncul tanpa pelaku", () => {
    const events = fakturHistory(input);
    expect(events.map((e) => e.key)).toEqual(["koreksi:c1", "hapus-penerimaan:x1", "batal:inv-gone"]);
    expect(events[2].actor).toBe("Tidak tercatat");
    expect(events[2].reason).toBe("Dobel input");
  });

  it("faktur batal yang sudah punya koreksi tidak ditulis dua kali", () => {
    expect(fakturHistory(input).filter((e) => e.key.startsWith("batal:")).map((e) => e.key)).toEqual(["batal:inv-gone"]);
  });

  it("nomor pengganti dicari juga di faktur terkait yang bukan leluhur, tanpa membuat kejadian baru", () => {
    const related = [{ id: "inv-next", no_faktur: "FJ-003", status: "batal", replaces_invoice_id: "inv-new", voided_on: "2026-11-05", void_reason: "x" }];
    const events = fakturHistory({ ...input, related, corrections: [{ ...input.corrections[0], invoice_id: "inv-new", id: "c9" }] });
    expect(events.find((e) => e.key === "koreksi:c9")!.detail.join(" ")).toContain("FJ-002 → FJ-003");
    expect(events.some((e) => e.key === "batal:inv-next")).toBe(false);
  });

  it("tanpa data = daftar kosong", () => {
    expect(fakturHistory({ viewerId: "u", names, invoices: [], corrections: [], cancellations: [], receipts: [] })).toEqual([]);
  });

  it("jurnal ditampilkan sebagai kode pendek, bukan UUID mentah", () => {
    const text = fakturHistory(input).flatMap((e) => e.detail).join(" ");
    expect(text).toContain("aaaaaaaa");
    expect(text).not.toContain("aaaaaaaa-1111");
  });
});

describe("klinikHistory", () => {
  const base = {
    viewerId: "u-fin", names,
    editLog: [
      { id: "e1", invoice_id: "i2", field_changed: "diskon", old_value: "0", new_value: "10", reason: "Promo lupa", edited_at: "2026-11-03T05:00:00Z", edited_by: "u-owner", editor_name: null },
      { id: "e2", invoice_id: "i1", field_changed: "voided", old_value: null, new_value: "true", reason: "Salah item", edited_at: "2026-11-03T04:00:00Z", edited_by: "u-fin", editor_name: "Fajar F." },
    ],
    invoices: [
      { id: "i1", invoice_no: "INV-1", reissued_from: null, created_at: "2026-11-01T01:00:00Z", voided_at: "2026-11-03T04:00:00Z" },
      { id: "i2", invoice_no: "INV-2", reissued_from: "i1", created_at: "2026-11-03T04:00:05Z", voided_at: null },
    ],
    corrections: [{ id: "k1", revision: 1, amount: 50000, from_method: "Tunai", to_method: "Transfer", reason: "Salah metode", created_at: "2026-11-02T08:00:00Z", created_by: "u-fin" }],
    refunds: [{ id: "f1", no_refund: "RF-1", tanggal: "2026-11-04", total: 25000, method: "Tunai", keterangan: "Obat kembali", created_at: "2026-11-04T02:00:00Z", created_by: "u-owner" }],
    receipts: [
      { id: "q1", no_kwitansi: "KW-1", total: 300000, status: "batal", void_reason: "Salah nominal", voided_at: "2026-11-02T01:00:00Z", voided_by: "u-fin" },
      { id: "q2", no_kwitansi: "KW-2", total: 100000, status: "aktif", void_reason: null, voided_at: null, voided_by: null },
    ],
  };

  it("menggabungkan log edit, terbit ulang, koreksi metode, refund dan batal kwitansi dalam satu garis waktu", () => {
    const events = klinikHistory(base);
    expect(events.map((e) => e.key)).toEqual(["refund:f1", "edit:e1", "terbit-ulang:i2", "edit:e2", "koreksi-metode:k1", "batal-kwitansi:q1"]);
  });

  it("log edit memakai nama tersimpan bila ada, jika tidak nama terbaca, dan menunjukkan sebelum → sesudah", () => {
    const events = klinikHistory(base);
    const edit = events.find((e) => e.key === "edit:e1")!;
    expect(edit.actor).toBe("Rina Owner");
    expect(edit.detail.join(" ")).toContain("diskon: 0 → 10");
    expect(edit.reason).toBe("Promo lupa");
    expect(events.find((e) => e.key === "edit:e2")!.actor).toBe("Fajar F.");
  });

  it("terbit ulang menunjukkan nomor lama → baru dengan pelaku dari log 'voided' pada invoice lama", () => {
    const e = klinikHistory(base).find((x) => x.key === "terbit-ulang:i2")!;
    expect(e.detail.join(" ")).toContain("INV-1 → INV-2");
    expect(e.actor).toBe("Fajar F.");
    expect(e.at).toBe("2026-11-03T04:00:05Z");
  });

  it("terbit ulang tanpa log pelaku tetap muncul sebagai tidak tercatat", () => {
    const e = klinikHistory({ ...base, editLog: [] }).find((x) => x.key === "terbit-ulang:i2")!;
    expect(e.actor).toBe("Tidak tercatat");
  });

  it("koreksi metode dan refund menyebut nilai dan metode; kwitansi aktif tidak ikut", () => {
    const events = klinikHistory(base);
    const km = events.find((e) => e.key === "koreksi-metode:k1")!;
    expect(km.detail.join(" ")).toContain("Tunai → Transfer");
    expect(km.detail.join(" ")).toContain("Rp 50.000");
    expect(km.actor).toBe("Fajar Finance");
    const rf = events.find((e) => e.key === "refund:f1")!;
    expect(rf.detail.join(" ")).toContain("RF-1");
    expect(rf.detail.join(" ")).toContain("Rp 25.000");
    expect(events.some((e) => e.key.includes("q2"))).toBe(false);
    const kw = events.find((e) => e.key === "batal-kwitansi:q1")!;
    expect(kw.reason).toBe("Salah nominal");
    expect(kw.detail.join(" ")).toContain("KW-1");
  });
});

describe("petshopHistory", () => {
  it("koreksi metode, pembatalan dan retur", () => {
    const events = petshopHistory({
      viewerId: "u-owner", names,
      corrections: [{ id: "p1", revision: 1, reason: "Salah metode", created_at: "2026-11-02T08:00:00Z", created_by: "u-fin",
        before_payments: [{ method: "Tunai", amount: 100000 }], after_payments: [{ method: "Transfer", amount: 100000 }] }],
      cancellation: { id: "z1", reason: "Dobel scan", created_at: "2026-11-03T08:00:00Z", created_by: "u-owner" },
      returns: [{ id: "t1", no_retur: "RT-1", tanggal: "2026-11-01", total: 20000, voided_at: null }],
    });
    expect(events.map((e) => e.key)).toEqual(["batal:z1", "koreksi-metode:p1", "retur:t1"]);
    expect(events[0].actor).toBe("Rina Owner");
    expect(events[0].tone).toBe("danger");
    expect(events[1].detail.join(" ")).toContain("Tunai Rp 100.000 → Transfer Rp 100.000");
    expect(events[2].detail.join(" ")).toContain("RT-1");
  });
  it("tanpa data = kosong", () => {
    expect(petshopHistory({ viewerId: "u", names, corrections: [], cancellation: null, returns: [] })).toEqual([]);
  });
});
