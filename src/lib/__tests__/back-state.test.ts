import { describe, expect, it } from "vitest";
import {
  LIST_SCROLL_KEY, LIST_URL_KEY, LIST_URL_TTL_MS, MAX_LIST_URLS, MAX_SCROLL_ENTRIES, PENDING_SCROLL_KEY,
  kunciHalaman, markPendingScroll, pulihkanGulir, readScroll, rememberListUrl, rememberScroll, resolveBackHref, takePendingScroll,
} from "../back-state";

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    data,
  };
}

describe("kunciHalaman", () => {
  it("memuat filter dan halaman tetapi membuang parameter sekali pakai", () => {
    expect(kunciHalaman("/pos/sku", "view=all&cari=pentacat&hal=2")).toBe("/pos/sku?view=all&cari=pentacat&hal=2");
    expect(kunciHalaman("/pos/sku", "cari=a&success=1&error=x")).toBe("/pos/sku?cari=a");
    expect(kunciHalaman("/pos/transaksi", "tgl=2026-11-01&completed_sale_id=abc&draft_used=1&hpp_warning=1")).toBe("/pos/transaksi?tgl=2026-11-01");
    expect(kunciHalaman("/pos/sku", "success=1")).toBe("/pos/sku");
    expect(kunciHalaman("/pos/sku")).toBe("/pos/sku");
  });
});

describe("rememberListUrl + resolveBackHref", () => {
  const NOW = 1_800_000_000_000;

  it("kasus Andri: cari pentacat, buka detail, Kembali membawa filter yang sama", () => {
    const store = fakeStore();
    rememberListUrl(store, "/pos/sku", "view=all&cari=pentacat&jenis=&induk=", NOW);
    expect(resolveBackHref(store, "/pos/sku", "/pos/sku/abc", NOW + 1000)).toBe("/pos/sku?view=all&cari=pentacat&jenis=&induk=");
  });

  it("tanpa catatan (belum pernah lihat daftar) memakai href cadangan", () => {
    expect(resolveBackHref(fakeStore(), "/pos/sku", "/pos/sku/abc", NOW)).toBe("/pos/sku");
    expect(resolveBackHref(null, "/pos/sku", "/pos/sku/abc", NOW)).toBe("/pos/sku");
    expect(resolveBackHref(undefined, "/pos/sku", "", NOW)).toBe("/pos/sku");
  });

  it("kunjungan polos terbaru menghapus filter lama (daftar baru yang bersih)", () => {
    const store = fakeStore();
    rememberListUrl(store, "/pos/sku", "cari=a", NOW);
    rememberListUrl(store, "/pos/sku", "", NOW + 10);
    expect(resolveBackHref(store, "/pos/sku", "/pos/sku/abc", NOW + 20)).toBe("/pos/sku");
  });

  it("pesan sukses tidak ikut diingat sehingga tidak muncul lagi", () => {
    const store = fakeStore();
    rememberListUrl(store, "/pos/sku", "cari=a&success=1", NOW);
    expect(resolveBackHref(store, "/pos/sku", "/pos/sku/abc", NOW)).toBe("/pos/sku?cari=a");
  });

  it("tiap daftar punya catatan sendiri", () => {
    const store = fakeStore();
    rememberListUrl(store, "/pos/sku", "cari=a", NOW);
    rememberListUrl(store, "/pembelian/faktur", "hal=3&tampil=1", NOW);
    expect(resolveBackHref(store, "/pembelian/faktur", "/pembelian/faktur/x", NOW)).toBe("/pembelian/faktur?hal=3&tampil=1");
    expect(resolveBackHref(store, "/pos/sku", "/pos/sku/x", NOW)).toBe("/pos/sku?cari=a");
    expect(resolveBackHref(store, "/pos/stok", "/pos/sku/x", NOW)).toBe("/pos/stok");
  });

  it("tidak mengubah tautan ke halaman tempat pengguna berada sekarang", () => {
    const store = fakeStore();
    rememberListUrl(store, "/crm/promo", "status=aktif", NOW);
    expect(resolveBackHref(store, "/crm/promo", "/crm/promo", NOW)).toBe("/crm/promo");
  });

  it("catatan basi (lewat 2 jam) atau berasal dari masa depan diabaikan", () => {
    const store = fakeStore();
    rememberListUrl(store, "/pos/sku", "cari=a", NOW);
    expect(resolveBackHref(store, "/pos/sku", "/x", NOW + LIST_URL_TTL_MS)).toBe("/pos/sku?cari=a");
    expect(resolveBackHref(store, "/pos/sku", "/x", NOW + LIST_URL_TTL_MS + 1)).toBe("/pos/sku");
    expect(resolveBackHref(store, "/pos/sku", "/x", NOW - 1)).toBe("/pos/sku");
  });

  it("href dengan query hanya diganti bila query-nya termuat di alamat tersimpan (tab yang sama)", () => {
    const store = fakeStore();
    rememberListUrl(store, "/kasir/persediaan", "tab=permintaan&q=gudang", NOW);
    expect(resolveBackHref(store, "/kasir/persediaan?tab=permintaan", "/x", NOW)).toBe("/kasir/persediaan?tab=permintaan&q=gudang");
    expect(resolveBackHref(store, "/kasir/persediaan?tab=penerimaan", "/x", NOW)).toBe("/kasir/persediaan?tab=penerimaan");
    expect(resolveBackHref(store, "/kasir/persediaan?tab=permintaan&x=1", "/x", NOW)).toBe("/kasir/persediaan?tab=permintaan&x=1");
  });

  it("menolak href yang bukan path internal polos", () => {
    const store = fakeStore();
    rememberListUrl(store, "/pos/sku", "cari=a", NOW);
    for (const href of ["//evil.example/pos/sku", "https://x.test/pos/sku", "pos/sku", "/pos/sku#bagian", "/pos\\sku", "/", ""]) {
      expect(resolveBackHref(store, href, "/x", NOW)).toBe(href);
    }
  });

  it("catatan yang dirusak/disusupi tidak pernah dipakai", () => {
    const rusak = (u: unknown) => fakeStore({ [LIST_URL_KEY]: JSON.stringify({ "/pos/sku": { u, t: NOW } }) });
    for (const u of ["https://evil.test/", "//evil.test/pos/sku?x", "/pos/stok?cari=a", "/pos/sku?a=1#frag", "/pos/sku?a=\\1", "/pos/skuX?a=1", 42, null]) {
      expect(resolveBackHref(rusak(u), "/pos/sku", "/x", NOW)).toBe("/pos/sku");
    }
    expect(resolveBackHref(fakeStore({ [LIST_URL_KEY]: "bukan json" }), "/pos/sku", "/x", NOW)).toBe("/pos/sku");
    expect(resolveBackHref(fakeStore({ [LIST_URL_KEY]: JSON.stringify({ "/pos/sku": { u: "/pos/sku?a=1" } }) }), "/pos/sku", "/x", NOW)).toBe("/pos/sku");
    expect(resolveBackHref(fakeStore({ [LIST_URL_KEY]: JSON.stringify(["x"]) }), "/pos/sku", "/x", NOW)).toBe("/pos/sku");
  });

  it("tidak mencatat beranda atau alamat yang bukan path polos", () => {
    const store = fakeStore();
    rememberListUrl(store, "/", "sudut=a", NOW);
    rememberListUrl(store, "//evil", "a=1", NOW);
    rememberListUrl(store, "/a?b=1", "", NOW);
    expect(store.data.has(LIST_URL_KEY)).toBe(false);
  });

  it("membatasi jumlah catatan dan membuang yang paling lama", () => {
    const store = fakeStore();
    for (let i = 0; i < MAX_LIST_URLS + 5; i++) rememberListUrl(store, `/m${i}`, "a=1", NOW + i);
    const map = JSON.parse(store.getItem(LIST_URL_KEY)!);
    expect(Object.keys(map)).toHaveLength(MAX_LIST_URLS);
    expect(map["/m0"]).toBeUndefined();
    expect(map[`/m${MAX_LIST_URLS + 4}`]).toBeDefined();
  });

  it("penyimpanan yang menolak tulis tidak membuat galat", () => {
    const store = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => rememberListUrl(store, "/pos/sku", "a=1", NOW)).not.toThrow();
    expect(() => rememberScroll(store, "/pos/sku", 100, NOW)).not.toThrow();
    expect(() => markPendingScroll(store, "/pos/sku", NOW)).not.toThrow();
  });
});

describe("posisi gulir", () => {
  it("menyimpan dan membaca per alamat lengkap; nol menghapus", () => {
    const store = fakeStore();
    rememberScroll(store, "/pos/sku?cari=a", 640.4, 1);
    rememberScroll(store, "/pos/sku", 90, 2);
    expect(readScroll(store, "/pos/sku?cari=a")).toBe(640);
    expect(readScroll(store, "/pos/sku")).toBe(90);
    expect(readScroll(store, "/pos/sku?cari=b")).toBeNull();
    rememberScroll(store, "/pos/sku?cari=a", 0, 3);
    expect(readScroll(store, "/pos/sku?cari=a")).toBeNull();
  });

  it("menolak masukan tidak sah dan membatasi jumlah", () => {
    const store = fakeStore();
    rememberScroll(store, "http://x", 10, 1);
    rememberScroll(store, "/a", Number.NaN, 1);
    expect(store.data.has(LIST_SCROLL_KEY)).toBe(false);
    for (let i = 0; i < MAX_SCROLL_ENTRIES + 3; i++) rememberScroll(store, `/a${i}`, 10 + i, i);
    expect(Object.keys(JSON.parse(store.getItem(LIST_SCROLL_KEY)!))).toHaveLength(MAX_SCROLL_ENTRIES);
    expect(readScroll(store, "/a0")).toBeNull();
    expect(readScroll(fakeStore({ [LIST_SCROLL_KEY]: JSON.stringify({ "/a": { y: "9", t: 1 } }) }), "/a")).toBeNull();
  });
});

describe("tanda pulihkan gulir dari BackLink", () => {
  it("sekali pakai, hanya untuk alamat yang ditandai, dan kedaluwarsa", () => {
    const store = fakeStore();
    markPendingScroll(store, "/pos/sku?cari=a", 1000);
    expect(takePendingScroll(store, "/pos/sku?cari=b", 1500)).toBe(false);
    expect(store.data.has(PENDING_SCROLL_KEY)).toBe(false); // sudah dikonsumsi walau tidak cocok

    markPendingScroll(store, "/pos/sku?cari=a", 1000);
    expect(takePendingScroll(store, "/pos/sku?cari=a", 1500)).toBe(true);
    expect(takePendingScroll(store, "/pos/sku?cari=a", 1500)).toBe(false);

    markPendingScroll(store, "/pos/sku?cari=a", 1000);
    expect(takePendingScroll(store, "/pos/sku?cari=a", 1000 + 15_001)).toBe(false);
    markPendingScroll(store, "/pos/sku?cari=a", 5000);
    expect(takePendingScroll(store, "/pos/sku?cari=a", 4000)).toBe(false);
    expect(takePendingScroll(fakeStore({ [PENDING_SCROLL_KEY]: "bukan json" }), "/a", 1)).toBe(false);
    expect(takePendingScroll(null, "/a", 1)).toBe(false);
  });
});

describe("pulihkanGulir", () => {
  function setup(tinggi: number, klien = 500) {
    const el = { scrollTop: 0, scrollHeight: tinggi, clientHeight: klien };
    const queue: (() => void)[] = [];
    let waktu = 0;
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: (n: string, f: EventListenerOrEventListenerObject) => { listeners.set(n, f as () => void); },
      removeEventListener: (n: string) => { listeners.delete(n); },
    };
    const raf = (cb: () => void) => { queue.push(cb); };
    const langkah = (n = 1, ms = 16) => { for (let i = 0; i < n && queue.length; i++) { waktu += ms; queue.shift()!(); } };
    return { el, listeners, target, raf, now: () => waktu, langkah, queue };
  }

  it("menunggu isi cukup tinggi, lalu menggulir ke posisi tersimpan dan berhenti", () => {
    const s = setup(500); // belum ada isi (hanya kerangka)
    let selesai = false;
    pulihkanGulir(() => s.el, 900, { now: s.now, raf: s.raf, target: s.target, onDone: () => { selesai = true; } });
    s.langkah(3);
    expect(s.el.scrollTop).toBe(0);
    s.el.scrollHeight = 2000; // isi tiba
    s.langkah(6);
    expect(s.el.scrollTop).toBe(900);
    expect(selesai).toBe(true);
    expect(s.listeners.size).toBe(0);
  });

  it("berhenti begitu pengguna menggulir sendiri", () => {
    const s = setup(2000);
    pulihkanGulir(() => s.el, 900, { now: s.now, raf: s.raf, target: s.target });
    expect(s.listeners.has("wheel")).toBe(true);
    s.listeners.get("wheel")!();
    s.langkah(5);
    expect(s.el.scrollTop).toBe(0);
    expect(s.listeners.size).toBe(0);
  });

  it("lewat batas waktu: gulir ke bawah semampunya lalu berhenti", () => {
    const s = setup(800); // maks gulir 300 < 900
    let selesai = false;
    pulihkanGulir(() => s.el, 900, { maxMs: 100, now: s.now, raf: s.raf, target: s.target, onDone: () => { selesai = true; } });
    s.langkah(20, 20);
    expect(s.el.scrollTop).toBe(300);
    expect(selesai).toBe(true);
  });

  it("pembatal menghentikan pemulihan", () => {
    const s = setup(2000);
    const batal = pulihkanGulir(() => s.el, 900, { now: s.now, raf: s.raf, target: s.target });
    batal();
    s.langkah(5);
    expect(s.el.scrollTop).toBe(0);
  });

  it("tanpa wadah gulir tidak galat dan berhenti di batas waktu", () => {
    const s = setup(2000);
    let selesai = false;
    pulihkanGulir(() => null, 900, { maxMs: 50, now: s.now, raf: s.raf, target: s.target, onDone: () => { selesai = true; } });
    s.langkah(10, 20);
    expect(selesai).toBe(true);
  });
});
