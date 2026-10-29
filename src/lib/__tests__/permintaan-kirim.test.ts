import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bacaQtyKirim, faktorBaris, kurangStokPermintaan, siapkanKirim, tersediaSatuanDokumen,
  type BarisPermintaan,
} from "../permintaan-kirim";
import { labelSource } from "../kartu-stok";
import { formatKekuranganStok } from "../stok-kurang";

// Kekurangannya sekarang baris terstruktur (dipakai popup); kalimat `?error=`
// dibentuk `formatKekuranganStok`. Pembantu ini menguji keduanya sekaligus.
const pesanKurangStok = (rows: Parameters<typeof kurangStokPermintaan>[0], stok: Parameters<typeof kurangStokPermintaan>[1]) => {
  const baris = kurangStokPermintaan(rows, stok);
  return baris.length ? formatKekuranganStok(baris) : null;
};

const baris = (p: Partial<BarisPermintaan> & { id: string }): BarisPermintaan => ({
  nama: "Obat A", satuan: "pcs", faktor: 1, item_id: "item-a",
  qty_diminta: 0, qty_disetujui: null, qty_dikirim: null, ...p,
});

describe("stok gudang pengirim dihitung dalam satuan dokumen", () => {
  it("saldo satuan dasar dibagi faktor, saldo minus dianggap nol", () => {
    expect(tersediaSatuanDokumen(250, 1)).toBe(250);
    expect(tersediaSatuanDokumen(250, 10)).toBe(25);   // 250 pcs = 25 box isi 10
    expect(tersediaSatuanDokumen(-40, 1)).toBe(0);     // stok minus tidak bisa dikirim
  });
  it("faktor kosong/nol/negatif tidak pernah dipakai membagi", () => {
    expect(faktorBaris(null)).toBe(1);
    expect(faktorBaris(0)).toBe(1);
    expect(faktorBaris(-5)).toBe(1);
    expect(faktorBaris(12)).toBe(12);
  });
});

describe("kasus yang dilaporkan: minta 500, gudang punya 250", () => {
  const rows = [baris({ id: "l1", qty_diminta: 500 })];

  it("persetujuan menandai kekurangannya dan mengusulkan sebanyak stok", () => {
    const hasil = siapkanKirim(rows, new Map([["item-a", 250]]), "diminta");
    expect(hasil[0]).toMatchObject({ plafon: 500, tersedia: 250, usulan: 250, kurang: true });
  });

  it("pesannya menyebut barang, jumlah diminta, dan jumlah tersedia", () => {
    const hasil = siapkanKirim(rows, new Map([["item-a", 250]]), "diminta");
    expect(pesanKurangStok(hasil, new Map([["item-a", 250]])))
      .toBe("Obat A butuh 500 pcs, tersedia 250 pcs");
  });

  it("tidak ada pesan bila stok cukup", () => {
    const hasil = siapkanKirim(rows, new Map([["item-a", 500]]), "diminta");
    expect(hasil[0].kurang).toBe(false);
    expect(pesanKurangStok(hasil, new Map([["item-a", 500]]))).toBeNull();
  });
});

describe("kiriman sebagian", () => {
  const rows = [baris({ id: "l1", qty_diminta: 500, qty_disetujui: 250 })];

  it("saat kirim, plafonnya qty disetujui — bukan qty diminta", () => {
    const hasil = siapkanKirim(rows, new Map([["item-a", 400]]), "disetujui");
    expect(hasil[0]).toMatchObject({ plafon: 250, tersedia: 400, usulan: 250, kurang: false });
  });

  it("qty kirim boleh lebih kecil dari yang disetujui, tapi tidak boleh lebih besar", () => {
    const hasil = siapkanKirim(rows, new Map([["item-a", 400]]), "disetujui");
    expect(bacaQtyKirim(hasil, () => "100")).toEqual([{ id: "l1", qty: 100 }]);
    expect(bacaQtyKirim(hasil, () => "9999")).toEqual([{ id: "l1", qty: 250 }]);
    expect(bacaQtyKirim(hasil, () => "-5")).toEqual([{ id: "l1", qty: 0 }]);
    expect(bacaQtyKirim(hasil, () => null)).toEqual([{ id: "l1", qty: 250 }]);
  });
});

describe("satu barang di dua baris tidak boleh lolos berdua", () => {
  const rows = [
    baris({ id: "l1", qty_diminta: 150 }),
    baris({ id: "l2", qty_diminta: 150 }),
  ];
  it("jatah stok dibagi berurutan, bukan dihitung penuh untuk tiap baris", () => {
    const hasil = siapkanKirim(rows, new Map([["item-a", 250]]), "diminta");
    expect(hasil.map((r) => r.usulan)).toEqual([150, 100]);
  });
  it("pesan kekurangan menjumlahkan kebutuhan per barang", () => {
    const hasil = siapkanKirim(rows, new Map([["item-a", 250]]), "diminta");
    expect(pesanKurangStok(hasil, new Map([["item-a", 250]])))
      .toBe("Obat A butuh 300 pcs, tersedia 250 pcs");
  });
});

describe("satuan besar", () => {
  it("stok 250 pcs = 25 box; minta 30 box ditolak dengan angka box", () => {
    const rows = [baris({ id: "l1", nama: "Obat B", satuan: "box", faktor: 10, qty_diminta: 30 })];
    const stok = new Map([["item-a", 250]]);
    const hasil = siapkanKirim(rows, stok, "diminta");
    expect(hasil[0]).toMatchObject({ tersedia: 25, usulan: 25, kurang: true });
    expect(pesanKurangStok(hasil, stok)).toBe("Obat B butuh 30 box, tersedia 25 box");
  });
});

describe("kartu stok menamai mutasi pengiriman permintaan", () => {
  it("keluar gudang, masuk cabang, dan sisa kiriman punya label sendiri", () => {
    expect(labelSource("kirim-permintaan")).toBe("Pengiriman Permintaan Barang");
    expect(labelSource("terima-permintaan")).toBe("Penerimaan Permintaan Barang");
    expect(labelSource("retur-permintaan")).toBe("Sisa Kiriman Kembali ke Gudang");
  });
});

// Tanpa database di CI, invarian SQL-nya diperiksa dari teks migrasi.
const NAMA = "20261030140000_permintaan_kirim_mengunci_stok.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");

describe("migrasi: kekurangan stok dihentikan di gudang pengirim", () => {
  it("dipasang paling akhir dan memakai gaya tambal jangkar eksak", () => {
    const semua = readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort();
    expect(semua).toContain(NAMA);
    // Dipasang sesudah migrasi yang terakhir menyentuh RPC stok — jangkarnya
    // dibaca dari definisi berjalan, jadi urutannya yang menentukan.
    expect(NAMA > "20261030100000_tindakan_racikan_pesanan.sql").toBe(true);
    expect(NAMA > "20261007110500_stock_transfer_request_atomic.sql").toBe(true);
    expect(SQL).toContain("pg_get_functiondef");
    expect(SQL).toContain("jangkar harus muncul tepat sekali");
    expect(SQL).toContain("do $check$");
    // Satu fungsi ditambal di teks dulu, baru dikompilasi sekali.
    expect(SQL).toContain("pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));");
  });

  it("persetujuan menolak qty di atas stok gudang pengirim", () => {
    expect(SQL).toContain("v_short:=stock_request_shortage(p_id,p_rows,false);");
    expect(SQL).toContain("Stok gudang pengirim tidak cukup. %. Turunkan jumlah yang disetujui");
  });

  it("pengiriman mengeluarkan stok gudang ke transit dalam RPC yang sama", () => {
    const rpc = SQL.slice(SQL.indexOf("create function public.ship_stock_request_atomic"),
      SQL.indexOf("revoke all on function public.ship_stock_request_atomic"));
    expect(rpc).toContain("select * into v_req from stock_requests where id=p_id for update;");
    expect(rpc).toContain("if v_req.status<>'Disetujui' then");
    expect(rpc).toContain("stock_request_shortage(p_id,p_rows,true)");
    expect(rpc).toContain("'kirim-permintaan'");
    expect(rpc).toContain("update stock_requests set status='Dikirim'");
    // Pemeriksaan stok harus mendahului mutasi stoknya.
    expect(rpc.indexOf("stock_request_shortage(p_id,p_rows,true)"))
      .toBeLessThan(rpc.indexOf("perform stock_transfer_fifo_exact"));
    // Qty kirim dipagari ke qty yang disetujui, dan baris dikunci.
    expect(rpc).toContain("v_row.qty>coalesce(v_line.qty_disetujui,v_line.qty_diminta)");
    expect(rpc).toContain("from stock_request_items where id=v_row.id and request_id=p_id for update;");
  });

  it("anti-balapan: saldo gudang dikunci sebelum dibandingkan", () => {
    const helper = SQL.slice(SQL.indexOf("create function public.stock_request_shortage"),
      SQL.indexOf("revoke all on function public.stock_request_shortage"));
    expect(helper).toContain("for update");
    expect(helper).toContain("group by i.item_id order by i.item_id");
    expect(helper).toContain("sum(x.qty*coalesce(nullif(i.faktor,0),1)) need");
  });

  it("penerimaan mengambil dari transit dan mengembalikan sisanya ke gudang pengirim", () => {
    expect(SQL).toContain("v_from:=coalesce(v_req.transit_warehouse_id,v_req.to_warehouse_id);");
    expect(SQL).toContain("stock_transfer_fifo_exact(v_from,v_wh,");
    expect(SQL).toContain("''retur-permintaan''");
    expect(SQL).toContain("coalesce(v_line.qty_dikirim,v_line.qty_disetujui,v_line.qty_diminta)");
  });

  it("browser tidak bisa lagi menandai Dikirim lewat update tabel", () => {
    expect(SQL).toContain("Pengiriman dicatat lewat layar Kirim barang");
    expect(SQL).toContain("Jejak pengiriman hanya ditulis oleh proses kirim barang");
    expect(SQL).toContain("new.qty_dikirim is not null");
  });

  it("pesan kekurangan pemindahan menyebut barang dan jumlahnya", () => {
    expect(SQL).toContain("Stok gudang asal tidak cukup: % perlu %, tersedia %");
  });

  it("sumber mutasi baru ikut dipagari dari pemanggilan langsung", () => {
    expect(SQL).toContain("''kirim-permintaan'', ''retur-permintaan''");
  });

  it("hanya Kepala Gudang / Manajer yang bisa mengirim, dan RPC-nya terbatas", () => {
    expect(SQL).toContain("role in ('OWNER','ADMIN')");
    expect(SQL).toContain("revoke all on function public.ship_stock_request_atomic(uuid,jsonb) from public,anon,service_role;");
    expect(SQL).toContain("grant execute on function public.ship_stock_request_atomic(uuid,jsonb) to authenticated;");
    expect(SQL).toContain("perform stock_document_access(v_branch,'pos');");
  });
});
