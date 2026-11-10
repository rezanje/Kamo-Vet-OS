#!/usr/bin/env python3
"""Uji migrasi 20261110043627 (kasir: stok tidak boleh minus) di PostgreSQL sungguhan, data fiktif.

Laporan Andri 10 Nov 2026: kartu stok turun 2 -> 0 -> -4 lewat Faktur Penjualan kasir. Keputusan grup: barang
dengan stok 0 tidak bisa ditransaksikan; saldo yang terlanjur minus dibiarkan (tidak ada data diubah).

Seluruh migrasi repo diputar dari nol TANPA migrasi ini, lalu:
  A. SEBELUM: kasir menjual 4 dari stok 2 -> lolos, saldo jadi -2 (bug terulang).
  B. Migrasi dipasang; pemasangan ulang gagal tertutup (KASIR_KUNCI_STOK_DRIFT); helper tidak bisa dipanggil
     langsung oleh authenticated/anon; sale_stock_out_fifo tetap bisa dipanggil authenticated.
  C. SESUDAH (sebagai kasir, lewat cashier_post_stock_atomic):
     - jual pas sama dengan stok -> lolos, saldo 0;
     - jual saat saldo 0 -> ditolak dengan pesan per barang, tidak ada stok/jurnal/HPP yang tertinggal;
     - saldo yang sudah minus tetap minus (tidak diubah) dan barangnya tetap tidak bisa dijual ("tersedia 0");
     - dua baris barang sama yang jumlahnya melebihi stok -> seluruh transaksi ditolak (baris pertama ikut batal);
     - komponen paket Grup yang kurang -> ditolak;
     - jasa tanpa stok tetap boleh bersama barang yang stoknya cukup.
  D. POS back-office (sale_stock_out_fifo langsung) memakai gerbang yang sama.
  E. Jalur di luar kasir tidak berubah: stock_out_fifo biasa (mis. pemakaian lain) masih boleh shortfall.

Tidak pernah terhubung ke Production.

    python3 scripts/test-kasir-kunci-stok-postgres.py [--pg-bin DIR]
"""
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fixture)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261110043627_kasir_kunci_stok_minus.sql"


def uid(group, n):
    return f"0a{group:02x}0000-0000-4000-8000-{n:012d}"


CASHIER = uid(0, 1)
BRANCH, WAREHOUSE, SHIFT, CASH = uid(1, 1), uid(2, 1), uid(3, 1), uid(4, 1)
FOOD, SAND, SERVICE, GROUP, OLD = uid(5, 1), uid(5, 2), uid(5, 3), uid(5, 4), uid(5, 5)

FIXTURES = f"""begin;
insert into auth.users(id,raw_user_meta_data) values('{CASHIER}','{{"full_name":"Kasir fiktif"}}');
update profiles set role='STAFF',is_active=true where id='{CASHIER}';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('{BRANCH}','KUNCIST','Cabang fiktif','PETSHOP');
insert into user_branches(user_id,branch_id) values('{CASHIER}','{BRANCH}');
insert into warehouses(id,branch_id,code,name,type) values('{WAREHOUSE}','{BRANCH}','WH_FIKTIF','Gudang fiktif','RETAIL');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values('{SHIFT}','{BRANCH}','{CASHIER}','petshop');
insert into items(id,code,name,unit,item_type,buy_price) values
 ('{FOOD}','KSFOOD','Makanan Kucing Fiktif','1/2KG','Persediaan',10),
 ('{SAND}','KSSAND','Pasir Fiktif','pcs','Persediaan',10),
 ('{SERVICE}','KSJASA','Jasa Fiktif','x','Jasa',0),
 ('{GROUP}','KSGRUP','Paket Fiktif','set','Grup',0),
 ('{OLD}','KSOLD','Barang Minus Lama','pcs','Persediaan',10);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values('{GROUP}','{SAND}',2,'pcs',1);
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','Test cash','ASET','D',false),('510001','Sales','PENDAPATAN','K',false),('520002','Discount','PENDAPATAN','D',false),
 ('312005','VAT','LIABILITAS','K',false),('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('{CASH}','Kas fiktif','Kas','1111');
insert into payment_account_map(metode,branch_id,cash_account_id) values('Tunai','{BRANCH}','{CASH}') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
commit;
"""

# Stok masuk seperti di Production: lapisan + saldo agregat bersamaan.
def isi_stok(item, qty):
    return f"""begin;
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
 values('{WAREHOUSE}','{item}',(now() at time zone 'Asia/Jakarta')::date,{qty},{qty},10,'purchase');
insert into stock(warehouse_id,item_id,qty) values('{WAREHOUSE}','{item}',{qty})
 on conflict(warehouse_id,item_id) do update set qty=public.stock.qty+excluded.qty;
commit;"""


SEBAGAI_KASIR = f"""set local role authenticated;
select set_config('request.jwt.claim.sub','{CASHIER}',true);
select set_config('request.jwt.claims','{{"role":"authenticated","sub":"{CASHIER}"}}',true);
"""


def jual(pg, ref, lines, group=None):
    """lines: [(item, qty, harga)]. group: (item_grup, qty, harga, komponen, qty_per_group). Hasil: (lolos, pesan)."""
    gross = sum(q * h for _, q, h in lines) + (group[1] * group[2] if group else 0)
    rows = "\n".join(
        f"insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) select id,'{i}','Baris kasir',{q},{h},"
        f"(select unit from items where id='{i}'),1,0 from sales where no_struk='{ref}';" for i, q, h in lines)
    grup = ""
    if group:
        gi, gq, gh, comp, per = group
        grup = f"""insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
 select id,'{gi}','Baris paket',{gq},{gh},'set',1,0 from sales where no_struk='{ref}';
insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp)
 select i.id,'{comp}','Komponen','Persediaan',{per},'pcs',1,{per * gq},0 from sale_items i join sales s on s.id=i.sale_id
 where s.no_struk='{ref}' and i.item_id='{gi}';"""
    out = pg.sql(f"""begin;
create temp table if not exists hasil(ref text, lolos boolean, pesan text);
grant all on hasil to authenticated;
{SEBAGAI_KASIR}
insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('{BRANCH}','{ref}',{gross},0,{gross},'Tunai',{gross},auth.uid(),'{SHIFT}',
 jsonb_build_array(jsonb_build_object('method','Tunai','amount',{gross})),'sql:{ref}',repeat('c',64));
{rows}
{grup}
do $$begin
 perform cashier_post_stock_atomic((select id from sales where no_struk='{ref}'),'{WAREHOUSE}');
 insert into hasil values('{ref}',true,null);
exception when others then insert into hasil values('{ref}',false,sqlerrm);
end$$;
select json_build_object('lolos',lolos,'pesan',pesan) from hasil where ref='{ref}';
commit;""").splitlines()[-1]
    r = json.loads(out)
    return r["lolos"], r["pesan"]


def saldo(pg, item):
    return float(pg.sql(f"select coalesce((select qty from stock where warehouse_id='{WAREHOUSE}' and item_id='{item}'),0);"))


def jejak(pg, ref):
    return pg.sql(f"""select (select count(*) from stock_moves where source_ref='{ref}')||'|'||
 (select count(*) from journal_entries where source_ref='{ref}')||'|'||
 coalesce((select sum(i.hpp) from sale_items i join sales s on s.id=i.sale_id where s.no_struk='{ref}'),0)||'|'||
 coalesce((select (payments_finalized_at is null)::text from sales where no_struk='{ref}'),'tidak ada');""")


def tanpa_jejak(pg, ref):
    """Tidak ada pergerakan stok, jurnal, maupun HPP; pembayaran masih tertunda (aplikasi lalu menghapus header)."""
    moves, journals, hpp, pending = jejak(pg, ref).split("|")
    return moves == "0" and journals == "0" and float(hpp) == 0 and pending == "true"


def gagal(pg, sql, potongan):
    try:
        pg.sql(sql)
    except RuntimeError as e:
        assert potongan in str(e), str(e)[:800]
        return
    raise AssertionError(f"seharusnya ditolak: {potongan}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    args = ap.parse_args()
    Path("/opt/data").mkdir(parents=True, exist_ok=True)
    with NativePostgres(args.pg_bin) as pg:
        # Bootstrap identik dengan harness Docker (shim auth/storage + semua migrasi), KECUALI migrasi ini.
        teks_migrasi = MIGRASI.read_text()

        class TanpaMigrasiIni:
            def sql(self, source):
                return "" if teks_migrasi in source else pg.sql(source)

        fixture.DisposablePostgres.bootstrap(TanpaMigrasiIni())
        pg.sql(FIXTURES)

        # A. Bug terulang sebelum migrasi.
        pg.sql(isi_stok(FOOD, 2))
        lolos, pesan = jual(pg, "KS.SEBELUM", [(FOOD, 4, 20)])
        assert lolos, pesan
        assert saldo(pg, FOOD) == -2, saldo(pg, FOOD)
        print("PASS A: sebelum perbaikan, kasir menjual 4 dari stok 2 dan saldo jadi -2 (bug laporan terulang)", flush=True)

        # B. Pasang migrasi.
        pg.sql("begin;\n" + MIGRASI.read_text() + "\ncommit;")
        gagal(pg, "begin;\n" + MIGRASI.read_text() + "\ncommit;", "already exists")
        do_saja = MIGRASI.read_text().split("do $$", 1)[1].split("end $$;", 1)[0]
        gagal(pg, "do $$" + do_saja + "end $$;", "KASIR_KUNCI_STOK_DRIFT")
        hak = pg.sql("""select has_function_privilege('authenticated','public.sale_stock_assert_available(uuid,uuid,numeric)','EXECUTE')||'|'||
 has_function_privilege('anon','public.sale_stock_assert_available(uuid,uuid,numeric)','EXECUTE')||'|'||
 has_function_privilege('authenticated','public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid)','EXECUTE')||'|'||
 has_function_privilege('anon','public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid)','EXECUTE');""")
        assert hak == "false|false|true|false", hak
        print("PASS B: migrasi terpasang; pasang ulang gagal tertutup; helper tertutup, sale_stock_out_fifo tetap untuk authenticated", flush=True)

        # C. Kasir sesudah perbaikan.
        pg.sql(isi_stok(SAND, 5))
        lolos, pesan = jual(pg, "KS.PAS", [(SAND, 5, 20)])
        assert lolos, pesan
        assert saldo(pg, SAND) == 0
        assert jejak(pg, "KS.PAS").startswith("1|"), jejak(pg, "KS.PAS")

        lolos, pesan = jual(pg, "KS.NOL", [(SAND, 1, 20)])
        assert not lolos and pesan == "Stok gudang cabang tidak cukup: Pasir Fiktif butuh 1 pcs, tersedia 0 pcs", pesan
        assert tanpa_jejak(pg, "KS.NOL"), jejak(pg, "KS.NOL")
        assert saldo(pg, SAND) == 0

        # Saldo minus dari sebelum perbaikan tidak diubah, dan barangnya tetap terkunci.
        lolos, pesan = jual(pg, "KS.MINUS", [(FOOD, 2, 20)])
        assert not lolos and pesan == "Stok gudang cabang tidak cukup: Makanan Kucing Fiktif butuh 2 1/2KG, tersedia 0 1/2KG", pesan
        assert saldo(pg, FOOD) == -2

        # Dua baris barang sama: 3 + 3 dari stok 5 -> seluruh struk batal, baris pertama ikut kembali.
        pg.sql(isi_stok(SAND, 5))
        lolos, pesan = jual(pg, "KS.DUA", [(SAND, 3, 20), (SAND, 3, 20)])
        assert not lolos and "Pasir Fiktif butuh 3 pcs, tersedia 2 pcs" in pesan, pesan
        assert tanpa_jejak(pg, "KS.DUA") and saldo(pg, SAND) == 5, (jejak(pg, "KS.DUA"), saldo(pg, SAND))

        # Paket Grup: 3 paket x 2 komponen = 6 dari stok 5 -> ditolak; 2 paket = 4 -> lolos.
        lolos, pesan = jual(pg, "KS.GRUP", [], group=(GROUP, 3, 50, SAND, 2))
        assert not lolos and "Pasir Fiktif butuh 6 pcs, tersedia 5 pcs" in pesan, pesan
        assert saldo(pg, SAND) == 5
        lolos, pesan = jual(pg, "KS.GRUP.OK", [], group=(GROUP, 2, 50, SAND, 2))
        assert lolos, pesan
        assert saldo(pg, SAND) == 1

        # Jasa tidak punya stok, tetap boleh bersama barang yang cukup.
        lolos, pesan = jual(pg, "KS.JASA", [(SAND, 1, 20), (SERVICE, 1, 15)])
        assert lolos, pesan
        assert saldo(pg, SAND) == 0
        print("PASS C: kasir — pas stok lolos; stok 0 dan saldo minus ditolak dengan pesan per barang tanpa jejak; "
              "dua baris sama & komponen Grup ikut dihitung; jasa tetap boleh; saldo minus lama tidak diubah", flush=True)

        # D. POS back-office memanggil sale_stock_out_fifo langsung (lib/inventory stockOut).
        pg.sql(isi_stok(OLD, 1))
        gagal(pg, f"""begin;
{SEBAGAI_KASIR}
insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('{BRANCH}','KS.BO',40,0,40,'Tunai',40,auth.uid(),'{SHIFT}',jsonb_build_array(jsonb_build_object('method','Tunai','amount',40)),'sql:KS.BO',repeat('b',64));
select * from sale_stock_out_fifo('{WAREHOUSE}','{OLD}',2,'sale','KS.BO',(now() at time zone 'Asia/Jakarta')::date,null);
commit;""", "Stok gudang cabang tidak cukup: Barang Minus Lama butuh 2 pcs, tersedia 1 pcs")
        assert saldo(pg, OLD) == 1
        print("PASS D: POS back-office (sale_stock_out_fifo langsung) ditolak lewat gerbang yang sama", flush=True)

        # E. Primitif stock_out_fifo untuk jalur lain tidak berubah (masih mengizinkan shortfall).
        sf = pg.sql(f"""begin;
select shortfall from stock_out_fifo('{WAREHOUSE}','{OLD}',3,'pakai-internal','KS.LAIN',(now() at time zone 'Asia/Jakarta')::date);
rollback;""").splitlines()
        assert any(x.strip() == "2" or x.strip().startswith("2.") for x in sf), sf
        print("PASS E: stock_out_fifo untuk jalur non-kasir tidak berubah", flush=True)
    print("SEMUA PEMERIKSAAN KUNCI STOK KASIR LULUS", flush=True)


if __name__ == "__main__":
    main()
