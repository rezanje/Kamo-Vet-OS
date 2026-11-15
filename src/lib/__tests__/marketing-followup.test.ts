import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEPAN_PILIHAN, FILTER_AWAL, HASIL_KONTAK, INTERVAL_GROOMING, PERIODE_LAMA, TAB_FOLLOWUP, bacaFilter, bacaHasilDaftar, jenisLogDari,
  kelompokPerCabang, kelompokPerPemilik, normalisasiHp, periksaIsianKontak, pesanWhatsapp, ringkasHewan, tanggalWib, tautanFilter, tautanWhatsapp,
  teksHariLalu, teksTerlewat, type BarisFollowUp,
} from "../marketing-followup";

const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/20261121100000_marketing_follow_up.sql"), "utf8");

const baris = (o: Partial<BarisFollowUp> = {}): BarisFollowUp => ({
  customer_id: "c1", pet_id: null, nama: "Budi", hp: "081234567890", wa: "6281234567890", hewan: ["Mochi"], hewan_total: 1, cabang_id: "b1", cabang: "Cabang A",
  terakhir: "2026-08-01T03:00:00Z", jenis_terakhir: "Klinik", total_belanja: 0, kunjungan: 1, hari: 106, sumber: null, jadwal: null, groomer: null, item: null, dihubungi: null, ...o,
});

describe("normalisasiHp (sama persis dengan marketing_normalisasi_hp di database)", () => {
  it.each([
    ["0812-3456-7890", "6281234567890"], ["+62 812 3456 7890", "6281234567890"], ["6281234567890", "6281234567890"], ["81234567890", "6281234567890"],
    ["0062 812 3456 7890", "6281234567890"], ["+62 0812 3456 7890", "6281234567890"], ["(0812) 3456.7890", "6281234567890"], ["0812345678", "62812345678"],
    ["081234567890", "6281234567890"],
  ])("%s -> %s", (masuk, keluar) => expect(normalisasiHp(masuk)).toBe(keluar));
  it.each(["021 555 1234", "0251123456", "0812345", "08123456", "08123456789012345", "08123456789012", "", null, undefined, "abc", "123", "0721 1234 5678"])(
    "bukan nomor HP sah: %s", (masuk) => expect(normalisasiHp(masuk as string | null)).toBeNull());
  it("kasus yang sama dengan uji PostgreSQL (A1/A2/A3): tidak boleh melenceng", () => {
    const py = readFileSync(join(__dirname, "../../../scripts/test-marketing-follow-up-postgres.py"), "utf8");
    const sah = [...py.matchAll(/"([^"]+)": "(62\d+)"/g)].map(m => [m[1], m[2]]).filter(([k]) => /^[+0-9() .-]+$/.test(k));
    expect(sah.length).toBeGreaterThanOrEqual(7);
    for (const [masuk, keluar] of sah) expect(normalisasiHp(masuk), masuk).toBe(keluar);
    const salah = py.match(/for src in \[([^\]]+)\]:\n\s+got = pg\.sql_db\(db, f"select coalesce\(public\.marketing_normalisasi_hp/)![1]
      .split(",").map(x => x.trim()).filter(x => x.startsWith('"')).map(x => x.slice(1, -1));
    expect(salah.length).toBeGreaterThanOrEqual(8);
    for (const masuk of salah) expect(normalisasiHp(masuk), masuk).toBeNull();
  });
  it("aturan di SQL: awalan 00/620/0/8 dan pola 628 + 7..11 digit sama dengan TS", () => {
    expect(SQL).toContain("'^628[0-9]{7,11}$'");
    expect(SQL).toContain("d like '00%' then d := substr(d, 3)");
    expect(SQL).toContain("d like '620%' then d := '62' || substr(d, 4)");
  });
});

describe("tautanWhatsapp", () => {
  it("memakai nomor 62 dan meng-encode seluruh pesan (tidak ada & ? # spasi atau baris baru yang lolos)", () => {
    const pesan = "Halo Kak Budi & Ani? #1\nBaris dua + 100% 😀 https://evil.example/?a=b";
    const url = tautanWhatsapp("0812-3456-7890", pesan)!;
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    const query = url.split("?text=")[1];
    expect(query).not.toMatch(/[ &?#\n]/);
    expect(decodeURIComponent(query)).toBe(pesan);
    expect(new URL(url).searchParams.get("text")).toBe(pesan);
    expect([...new URL(url).searchParams.keys()]).toEqual(["text"]);
  });
  it("nomor yang tidak sah tidak menghasilkan tautan (tidak ada suntikan lewat nomor)", () => {
    for (const x of ["", null, "abc", "0812/../evil", "javascript:alert(1)", "0251123456", "https://x.test/?a=1"]) expect(tautanWhatsapp(x as string, "hai"), String(x)).toBeNull();
    expect(tautanWhatsapp("0812abc3456789012?x=1", "hai")).toBeNull();
  });
  it("nomor dengan tanda baca dibersihkan ke angka saja", () => {
    expect(tautanWhatsapp("(+62) 812-3456-7890", "x")).toBe("https://wa.me/6281234567890?text=x");
  });
});

describe("pesanWhatsapp", () => {
  it("sopan, singkat, memakai nama dan hewan; nama dengan baris baru / terlalu panjang dirapikan", () => {
    const p = pesanWhatsapp("lama", { pemilik: "Budi\n\nSantoso", hewan: ["Mochi", "Kiki", "Tom", "Extra"], klinik: "Kamo Pets Ciawi" });
    expect(p).toContain("Halo Kak Budi Santoso");
    expect(p).toContain("Mochi, Kiki dan Tom");
    expect(p).not.toContain("Extra");
    expect(p).not.toContain("\n");
    expect(p.length).toBeLessThan(300);
    expect(pesanWhatsapp("lama", { pemilik: "X".repeat(200) }).length).toBeLessThan(260);
  });
  it("isi berbeda per daftar dan tanpa nama hewan tetap wajar", () => {
    expect(pesanWhatsapp("grooming", { pemilik: "Ani", hewan: ["Mimi"] })).toContain("sudah waktunya grooming");
    expect(pesanWhatsapp("hari_ini", { pemilik: "Ani", hewan: ["Mimi"] })).toContain("jadwal kontrol");
    expect(pesanWhatsapp("baru", { pemilik: "Ani" })).toContain("anabulnya");
    expect(pesanWhatsapp("lama", { pemilik: "" })).toContain("Halo Kak,");
  });
});

describe("saringan dari URL dan ambang periode", () => {
  it("ambang 60/90/180, interval 21/30/45, depan 0/1/3/7 sama dengan fungsi database", () => {
    expect([...PERIODE_LAMA]).toEqual([60, 90, 180]);
    expect([...INTERVAL_GROOMING]).toEqual([21, 30, 45]);
    expect(SQL).toContain("p_hari not in (60, 90, 180)");
    expect(SQL).toContain("p_interval not in (21, 30, 45)");
    expect([...DEPAN_PILIHAN].every(n => n >= 0 && n <= 14)).toBe(true);
    expect(SQL).toContain("(p_hari_ini - (a.terakhir at time zone 'Asia/Jakarta')::date) between 60 and c_batas_lama");
    expect(SQL).toContain("c_batas_lama constant integer := 730;");
  });
  it("jenis log dan hasil kontak sama dengan CHECK di tabel log", () => {
    for (const t of TAB_FOLLOWUP) expect(SQL, t.jenis).toContain(`'${t.jenis}'`);
    const cek = SQL.match(/hasil text not null check \(hasil in \(([^)]+)\)\)/)![1].split(",").map(x => x.trim().replace(/'/g, ""));
    expect(cek).toEqual([...HASIL_KONTAK]);
    expect(jenisLogDari("hari_ini")).toBe("followup_klinik");
  });
  it("nilai tak dikenal kembali ke bawaan; uuid cabang dan 'kosong' diterima; cari dirapikan", () => {
    expect(bacaFilter({})).toEqual(FILTER_AWAL);
    const f = bacaFilter({ tab: "grooming", hari: "45", interval: "21", depan: "9", status: "x", cabang: "1; drop table", cari: "  Budi   Santoso  ", tunggu: "30" });
    expect(f).toMatchObject({ tab: "grooming", hari: 90, interval: 21, depan: 0, status: "belum", cabang: "", cari: "Budi Santoso", cooldown: 30 });
    expect(bacaFilter({ cabang: "kosong" }).cabang).toBe("kosong");
    expect(bacaFilter({ cabang: "3c9fa638-c99d-4bb7-925b-e28b6bdb4564" }).cabang).toBe("3c9fa638-c99d-4bb7-925b-e28b6bdb4564");
    expect(bacaFilter({ cari: "x".repeat(200) }).cari.length).toBe(60);
    expect(bacaFilter({ tab: ["hari_ini", "lama"] }).tab).toBe("hari_ini");
  });
  it("tautanFilter hanya memuat nilai bukan-bawaan dan bisa dibaca kembali", () => {
    expect(tautanFilter(FILTER_AWAL)).toBe("/crm/follow-up?tab=lama");
    const f = { ...FILTER_AWAL, tab: "grooming" as const, interval: 45 as const, status: "sudah" as const, cari: "a b" };
    const url = tautanFilter(f);
    expect(bacaFilter(Object.fromEntries(new URL("http://x" + url).searchParams))).toEqual(f);
    expect(tautanFilter(f, { tab: "lama", cari: "" })).toContain("tab=lama");
  });
});

describe("pengelompokan", () => {
  it("satu pemilik dengan beberapa hewan menjadi satu kartu", () => {
    const k = kelompokPerPemilik([baris({ pet_id: "p1" }), baris({ customer_id: "c2", nama: "Ani" }), baris({ pet_id: "p2", hewan: ["Kiki"] })]);
    expect(k.map(x => [x.customer_id, x.baris.length])).toEqual([["c1", 2], ["c2", 1]]);
  });
  it("kelompok per cabang mengikuti cabang transaksi terakhir; tanpa cabang paling akhir", () => {
    const g = kelompokPerCabang([baris({ cabang_id: null, cabang: null, customer_id: "x" }), baris({ customer_id: "y" }), baris({ customer_id: "z", cabang_id: "b2", cabang: "Cabang B" })]);
    expect(g.map(x => x.nama)).toEqual(["Cabang A", "Cabang B", "Tanpa cabang (riwayat impor)"]);
    expect(g[2].id).toBeNull();
  });
});

describe("bacaHasilDaftar dan teks", () => {
  const sah = { tab: "lama", hari_ini: "2026-11-15", total: 1, belum: 1, sudah: 0, bucket: { "60": 1, "90": 1, "180": 0 }, cabang: [], tanpa_nomor: 0,
    dikecualikan: { kunjungan_belum_selesai: 0, hewan_tiada: 0, disembunyikan: 0 }, baris: [baris()] };
  it("menolak bentuk yang tidak dikenal (tidak menebak)", () => {
    expect(bacaHasilDaftar(sah)).not.toBeNull();
    for (const x of [null, {}, { ...sah, baris: "x" }, { ...sah, total: "1" }, { ...sah, bucket: undefined }, { ...sah, baris: [{ nama: 1 }] }, { ...sah, hari_ini: 5 }]) expect(bacaHasilDaftar(x)).toBeNull();
  });
  it("teks hari, hewan, tanggal", () => {
    expect(teksHariLalu(0)).toBe("hari ini"); expect(teksHariLalu(106)).toBe("106 hari lalu"); expect(teksHariLalu(null)).toBe("-");
    expect(teksTerlewat(10)).toBe("terlewat 10 hari"); expect(teksTerlewat(0)).toBe("hari ini"); expect(teksTerlewat(-3)).toBe("H-3");
    expect(ringkasHewan({ hewan: ["A", "B"], hewan_total: 5 })).toBe("A, B +3"); expect(ringkasHewan({ hewan: [], hewan_total: 0 })).toBe("Hewan tidak tercatat");
    expect(tanggalWib("2026-11-14T20:00:00Z")).toBe("2026-11-15"); expect(tanggalWib(null)).toBeNull(); expect(tanggalWib("bukan")).toBeNull();
  });
  it("isian Sudah dihubungi: hasil wajib dan catatan maksimal 500 huruf", () => {
    expect(periksaIsianKontak("", "")).toBe("Pilih hasil menghubungi.");
    expect(periksaIsianKontak("Apa saja", "")).toBe("Pilih hasil menghubungi.");
    expect(periksaIsianKontak("Nanti", "x".repeat(501))).toBe("Catatan maksimal 500 huruf.");
    expect(periksaIsianKontak("Nanti", "x".repeat(500))).toBeNull();
    expect(periksaIsianKontak("Tidak berminat", "  ")).toBeNull();
  });
});
