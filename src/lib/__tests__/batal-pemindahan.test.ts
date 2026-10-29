import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tanpa database di CI, invarian SQL-nya diperiksa dari teks migrasi.
const NAMA = "20261031100000_batal_pemindahan_barang.sql";
const SQL = readFileSync(`supabase/migrations/${NAMA}`, "utf8");
const potong = (awal: string, akhir: string) => SQL.slice(SQL.indexOf(awal), SQL.indexOf(akhir));

describe("migrasi: batalkan pengiriman", () => {
  it("terpasang sesudah migrasi yang terakhir menyentuh RPC stok", () => {
    const semua = readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort();
    expect(semua).toContain(NAMA);
    // Jangkar tambalannya dibaca dari definisi berjalan, jadi urutan minimal ini yang penting.
    expect(NAMA > "20261030140000_permintaan_kirim_mengunci_stok.sql").toBe(true);
    expect(NAMA > "20261007110500_stock_transfer_request_atomic.sql").toBe(true);
  });

  it("memakai gaya tambal jangkar eksak dan kompilasi sekali per fungsi", () => {
    expect(SQL).toContain("pg_get_functiondef");
    expect(SQL).toContain("jangkar harus muncul tepat sekali");
    expect(SQL).toContain("pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));");
    expect(SQL).toContain("do $check$");
  });

  it("tidak menyentuh file migrasi lama", () => {
    expect(SQL).not.toContain("drop function public.post_stock_transfer_atomic");
    expect(SQL).not.toContain("drop table");
  });
});

describe("RPC pembatalan pemindahan", () => {
  const rpc = potong("create function public.cancel_stock_transfer",
    "revoke all on function public.cancel_stock_transfer");

  it("mengunci dokumennya sebelum apa pun dibalik — anti batal ganda / batal saat diterima", () => {
    expect(rpc).toContain("select * into v_doc from stock_transfers where id = p_transfer_id for update;");
    expect(rpc.indexOf("for update")).toBeLessThan(rpc.indexOf("perform stock_transfer_fifo_exact"));
  });

  it("ditolak begitu ada satu dokumen penerimaan, atau status bukan Sedang dikirim", () => {
    expect(rpc).toContain("from stock_transfers d where d.source_transfer_id = v_doc.id");
    expect(rpc).toContain("v_doc.status is distinct from 'Sedang dikirim'::transfer_status");
    expect(rpc).toContain("sudah diterima gudang tujuan");
  });

  it("alasan wajib diisi dan dicatat bersama pelaku serta waktunya", () => {
    expect(rpc).toContain("Alasan pembatalan wajib diisi");
    expect(rpc).toContain("length(v_reason) not between 3 and 1000");
    expect(rpc).toContain("cancelled_at = now(), cancelled_by = auth.uid()");
    expect(rpc).toContain("cancel_reason = v_reason");
  });

  it("stok dibalik lewat primitif pemindahan yang sama, dokumen tetap ada", () => {
    expect(rpc).toContain("perform stock_transfer_fifo_exact(v_transit, v_doc.from_warehouse_id");
    expect(rpc).toContain("'transfer-batal'");
    expect(rpc).toContain("update stock_transfers set status = 'Dibatalkan'");
    expect(rpc).not.toContain("delete from stock_transfers");
    expect(rpc).not.toContain("delete from stock_transfer_items");
  });

  it("gudang transit dibaca dari jejak mutasinya, bukan ditebak", () => {
    expect(rpc).toContain("select array_agg(distinct warehouse_id) into v_whs from stock_moves");
    expect(rpc).toContain("source = 'transfer' and source_ref = v_doc.no_pemindahan and qty > 0");
    expect(rpc).toContain("array_length(v_whs, 1) <> 1");
  });

  it("izin sama dengan yang berhak mengirim dari gudang asal, diperiksa di database", () => {
    expect(rpc).toContain("perform stock_document_access(v_from.branch_id, 'pos');");
    expect(SQL).toContain("revoke all on function public.cancel_stock_transfer(uuid, uuid, text) from public, anon, service_role;");
    expect(SQL).toContain("grant execute on function public.cancel_stock_transfer(uuid, uuid, text) to authenticated;");
    expect(SQL).toContain("security definer");
  });

  it("panggilan ulang tidak membalik stok dua kali", () => {
    expect(rpc).toContain("if v_doc.cancelled_at is not null then");
    expect(rpc).toContain("'already_cancelled', true");
    expect(rpc.indexOf("if v_doc.cancelled_at is not null then"))
      .toBeLessThan(rpc.indexOf("perform stock_transfer_fifo_exact"));
    expect(SQL).toContain("add column cancel_request_key uuid unique");
  });
});

describe("RPC pembatalan pengiriman permintaan", () => {
  const rpc = potong("create function public.cancel_stock_request_shipment",
    "revoke all on function public.cancel_stock_request_shipment");

  it("mengunci permintaannya dan menolak bila cabang sudah mencatat penerimaan", () => {
    expect(rpc).toContain("select * into v_req from stock_requests where id = p_id for update;");
    expect(rpc).toContain("from stock_receipts where stock_request_id = p_id");
    expect(rpc).toContain("v_req.status <> 'Dikirim'");
  });

  it("stok transit kembali ke gudang pengirim dan permintaan kembali bisa dikirim", () => {
    expect(rpc).toContain("'batal-kirim-permintaan'");
    expect(rpc).toContain("perform stock_transfer_fifo_exact(v_transit, v_req.to_warehouse_id");
    expect(rpc).toContain("update stock_requests set status = 'Disetujui', shipped_at = null, shipped_by = null, transit_warehouse_id = null");
    expect(rpc).toContain("update stock_request_items set qty_dikirim = null");
  });

  it("izinnya sama persis dengan pengiriman: modul pos atas cabang gudang + Kepala Gudang/Manajer", () => {
    expect(rpc).toContain("perform stock_document_access(v_branch, 'pos');");
    expect(rpc).toContain("role in ('OWNER', 'ADMIN')");
  });

  it("alasan & pelakunya bisa dibaca layar permintaan — kolom yang dipakai ikut di-grant", () => {
    // Halaman detail permintaan membaca id/reason/created_at + nama pelaku lewat FK bawaan
    // stock_request_shipment_cancellations_actor_id_fkey. Kalau grant-nya menyempit, riwayat
    // pembatalan hilang dari layar tanpa error yang kelihatan.
    const grant = potong("grant select (id, request_id", "create policy stock_request_shipment_cancellation_read");
    for (const kolom of ["id", "request_id", "actor_id", "reason", "tanggal", "created_at"]) {
      expect(grant).toContain(kolom);
    }
    expect(SQL).toContain("actor_id uuid not null references public.profiles(id)");
  });

  it("buktinya tersimpan dan tidak bisa diubah, kunci yang sama tidak membalik dua kali", () => {
    expect(rpc).toContain("insert into stock_request_shipment_cancellations");
    expect(rpc).toContain("where actor_id = auth.uid() and request_key = p_request_key");
    expect(SQL).toContain("Bukti pembatalan pengiriman tidak dapat diubah atau dihapus");
    expect(SQL).toContain("unique (actor_id, request_key)");
  });
});

describe("pagar sekitar pembatalan", () => {
  it("sumber mutasi baru tidak bisa dipanggil langsung dari browser", () => {
    expect(SQL).toContain("''transfer-batal'', ''batal-kirim-permintaan''");
    expect(SQL).toContain("Sumber mutasi pembatalan belum dipagari");
  });

  it("browser tidak bisa mengembalikan status Dikirim -> Disetujui lewat update tabel", () => {
    expect(SQL).toContain("Pembatalan pengiriman dicatat lewat tombol Batalkan pengiriman");
  });

  it("stempel pembatalan pemindahan hanya lewat RPC: tabelnya tidak punya policy tulis", () => {
    expect(SQL).toContain("stock_transfers tidak boleh punya policy tulis");
  });

  it("tidak ada jurnal untuk pemindahan antar gudang, juga untuk pembatalannya", () => {
    expect(SQL).not.toContain("clinic_write_journal");
    expect(SQL).not.toContain("sales_write_journal");
    expect(SQL).toContain("Pemindahan barang tidak seharusnya punya jurnal");
  });
});
