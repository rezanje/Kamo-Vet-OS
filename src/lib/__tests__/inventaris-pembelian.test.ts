import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INVOP_PATH, INVOP_SUBMENU_ID, LABEL_JENIS, kunciPersetujuanPembelian, pesanGagal } from "../inventaris-operasional";
import { kunciKasKeluar } from "../persetujuan";
import { submenuOfPath } from "../submenu-access";

const SQL = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261207100000_inventaris_pembelian.sql"), "utf8");

describe("Catat Pembelian Inventaris Operasional", () => {
  it("kunci persetujuan identik dengan Kas Keluar biasa (aturan persetujuan tidak bisa dilewati)", () => {
    const o = { tanggal: "2026-11-23", accountId: "11111111-1111-4111-8111-111111111111", nominal: 1500000.4 };
    expect(kunciPersetujuanPembelian({ ...o, bebanCode: "740001" })).toBe(kunciKasKeluar({ tanggal: o.tanggal, accountId: o.accountId, lawanCode: "740001", jumlah: o.nominal }));
    // RPC memakai format yang sama: kas|tanggal|rekening|akun|nominal dibulatkan.
    expect(SQL).toContain("concat_ws('|','kas',v_today::text,p_account_id::text,v_beban,round(p_nominal)::bigint::text)");
  });
  it("pesan penolakan database diterjemahkan untuk petugas", () => {
    expect(pesanGagal("INVENTARIS_PEMBELIAN_FINANCE: x")).toMatch(/Hanya akun Finance/);
    expect(pesanGagal("INVENTARIS_KAS_TIDAK_SAH: x")).toMatch(/bukan milik cabang ini/);
    expect(pesanGagal("INVENTARIS_NOTA_WAJIB: x")).toMatch(/nota wajib/);
    expect(pesanGagal("INVENTARIS_PERLU_PERSETUJUAN: x")).toMatch(/persetujuan atasan/);
    expect(pesanGagal("INVENTARIS_KAS_TERKUNCI: x")).toMatch(/menu Inventaris Operasional/);
    expect(pesanGagal("INVENTARIS_BATAL_KURANG: x")).toMatch(/belum dibatalkan/);
    expect(pesanGagal("ERROR: Periode akuntansi sudah ditutup")).toBe("Periode akuntansi sudah ditutup");
  });
  it("label riwayat mencakup pembelian dan pembatalannya", () => {
    expect(LABEL_JENIS.pembelian).toBe("Pembelian");
    expect(LABEL_JENIS.batal_pembelian).toBe("Batal pembelian");
  });
  it("halaman pembelian di bawah sub-menu yang sama (tidak membuka modul/sub-menu lain)", () => {
    expect(submenuOfPath(`${INVOP_PATH}/pembelian`)?.id).toBe(INVOP_SUBMENU_ID);
  });
  it("migrasi: Finance saja, akun beban 740001 sebagai asumsi yang bisa diganti, pagar jalur kas umum", () => {
    expect(SQL).toMatch(/role::text='FINANCE'/);
    expect(SQL).toMatch(/beban_code text not null default '740001'/);
    expect(SQL).toMatch(/create trigger invop_purchase_cash_guard before update or delete on public\.cash_entries/);
    expect(SQL).toMatch(/create trigger invop_purchase_attachment_guard before update or delete on public\.document_attachments/);
    expect(SQL).not.toMatch(/\b(stock|stock_movements|stock_layers|items)\b\s*\(/);
  });
});
