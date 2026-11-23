import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INVOP_PATH, INVOP_SUBMENU_ID, parseOpnameForm, parseQty, pesanGagal, pilihCabang, selisih } from "../inventaris-operasional";
import { TILES } from "../nav";
import { SUBMENU_ENTRIES, submenuOfPath } from "../submenu-access";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SAPU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function form(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("parseQty", () => {
  it("menerima angka >= 0 dengan koma atau titik, maks. 2 desimal", () => {
    expect(parseQty("4")).toBe(4);
    expect(parseQty(" 2,5 ")).toBe(2.5);
    expect(parseQty("0")).toBe(0);
    expect(parseQty("1.25")).toBe(1.25);
  });
  it("menolak kosong, negatif, huruf, dan 3 desimal", () => {
    for (const v of ["", "-1", "abc", "1.234", "1e3", null, undefined]) expect(parseQty(v)).toBeNull();
  });
  it("selisih = fisik - tercatat tanpa galat pecahan", () => {
    expect(selisih(5, 4)).toBe(-1);
    expect(selisih(0.1, 0.3)).toBe(0.2);
    expect(selisih(3, 3)).toBe(0);
  });
});

describe("parseOpnameForm", () => {
  const nama = new Map([[SAPU, "Sapu"], [EMBER, "Ember"]]);
  it("membaca jumlah fisik dan alasan apa adanya (dirapikan), tanpa bergantung saldo terbaru", () => {
    const f = form([["item_id", SAPU], ["revision", "2"], ["fisik_" + SAPU, "4"], ["alasan_" + SAPU, " patah "],
      ["item_id", EMBER], ["revision", "1"], ["fisik_" + EMBER, "3"]]);
    const r = parseOpnameForm(f, nama);
    expect(r).toEqual({ ok: true, lines: [
      { item_id: SAPU, revision: 2, qty_fisik: 4, alasan: "patah" },
      { item_id: EMBER, revision: 1, qty_fisik: 3, alasan: null },
    ] });
    // Kiriman ulang formulir yang sama menghasilkan isi yang identik (database lalu mengembalikan opname pertama).
    expect(parseOpnameForm(f, new Map())).toEqual(r);
  });
  it("jumlah fisik kosong ditolak dengan nama barangnya", () => {
    expect(parseOpnameForm(form([["item_id", SAPU], ["revision", "1"], ["fisik_" + SAPU, ""]]), nama))
      .toEqual({ ok: false, error: 'Jumlah fisik "Sapu" wajib diisi (angka 0 atau lebih).' });
  });
  it("barang ganda, revisi rusak, atau formulir tidak lengkap ditolak", () => {
    expect(parseOpnameForm(form([["item_id", SAPU], ["revision", "1"], ["fisik_" + SAPU, "5"], ["item_id", SAPU], ["revision", "1"]])).ok).toBe(false);
    expect(parseOpnameForm(form([["item_id", SAPU], ["revision", "0"], ["fisik_" + SAPU, "5"]])).ok).toBe(false);
    expect(parseOpnameForm(form([["item_id", "bukan-uuid"], ["revision", "1"]])).ok).toBe(false);
    expect(parseOpnameForm(form([])).ok).toBe(false);
  });
});

describe("pilihCabang", () => {
  const list = [{ id: A, name: "Cabang A" }, { id: B, name: "Cabang B" }];
  it("pilihan cabang operasional sesi mengunci halaman ke cabang itu saja", () => {
    expect(pilihCabang(list, A, B)?.id).toBe(B);
    expect(pilihCabang([{ id: A, name: "Cabang A" }], undefined, B)).toBeNull();
  });
  it("tanpa pilihan sesi: ?cabang= bila diizinkan, selain itu cabang pertama", () => {
    expect(pilihCabang(list, B, null)?.id).toBe(B);
    expect(pilihCabang(list, "33333333-3333-4333-8333-333333333333", null)?.id).toBe(A);
    expect(pilihCabang([], A, null)).toBeNull();
  });
});

describe("pesanGagal", () => {
  it("menerjemahkan penolakan database ke kalimat petugas", () => {
    expect(pesanGagal("INVENTARIS_SALDO_BERUBAH: x")).toMatch(/sudah diubah orang lain/);
    expect(pesanGagal("INVENTARIS_CABANG_DITOLAK: x")).toBe("Anda tidak punya akses ke cabang ini.");
    expect(pesanGagal("INVENTARIS_MENU_DITOLAK: x")).toMatch(/belum diberi akses menu Inventaris Operasional/);
    expect(pesanGagal("ADMIN_ONLINE_FUNCTION_DENIED: x")).toBe("Anda tidak punya akses ke cabang ini.");
    expect(pesanGagal('ERROR: Alasan selisih "Sapu" wajib diisi (minimal 3 huruf)')).toBe('Alasan selisih "Sapu" wajib diisi (minimal 3 huruf)');
    expect(pesanGagal("random failure at line 3")).toMatch(/^Gagal menyimpan/);
  });
});

describe("menu dan akses", () => {
  it("tile Persediaan mengarah ke halaman dan dimiliki satu sub-menu Akses Grup", () => {
    expect(TILES.pos.some(t => t.label === "Inventaris Operasional" && t.href === INVOP_PATH)).toBe(true);
    expect(SUBMENU_ENTRIES.filter(e => e.id === INVOP_SUBMENU_ID).map(e => e.routes)).toEqual([[INVOP_PATH]]);
    for (const p of [INVOP_PATH, `${INVOP_PATH}/opname`, `${INVOP_PATH}/riwayat`]) expect(submenuOfPath(p)?.id).toBe(INVOP_SUBMENU_ID);
  });
  it("migrasi mendaftarkan id sub-menu yang sama di katalog database", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261206100000_inventaris_operasional.sql"), "utf8");
    expect(sql).toContain(`('${INVOP_SUBMENU_ID}','pos')`);
    // Hak menu ditegakkan di database juga (bukan hanya aplikasi): RLS baca dan fungsi tulis memakai gerbang yang sama.
    expect(sql.match(/using \(\(select public\.inventaris_operasional_allowed\(\)\) and public\.user_can_access_branch\(branch_id\)\)/g)).toHaveLength(3);
    expect(sql).toMatch(/if not public\.inventaris_operasional_allowed\(\) then\s+raise exception 'INVENTARIS_MENU_DITOLAK/);
    expect(sql).not.toMatch(/journal_entries|stock_movements|fixed_assets/);
  });
});
