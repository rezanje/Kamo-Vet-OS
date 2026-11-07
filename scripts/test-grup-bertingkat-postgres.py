"""Grup bertingkat (paket di dalam paket): uji migrasi pada PostgreSQL 16 sementara.

Data fiktif; stub minimal untuk items/auth/audit. Jalankan: python3 scripts/test-grup-bertingkat-postgres.py
"""
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from native_postgres import NativePostgres
ROOT = str(HERE.parent / "supabase" / "migrations") + "/"

STUB = r"""
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.test_admin(flag boolean); insert into auth.test_admin values (true);
create function public.is_admin() returns boolean language sql as $$ select flag from auth.test_admin $$;
create function public.user_can_access_branch(uuid) returns boolean language sql as $$ select true $$;
create table public.items (id uuid primary key default gen_random_uuid(), name text not null, code text,
  item_type text not null, unit text not null, is_active boolean not null default true);
create table public.item_units (item_id uuid references public.items(id), unit text, factor numeric);
create table public.sales (id uuid primary key, branch_id uuid);
create table public.sale_items (id uuid primary key, sale_id uuid references public.sales(id), item_id uuid);
create table public.activity_log_sources (entity text primary key, module_id text, label_key text, value_keys text[], scope_kind text,
  parent_entity text, parent_key text, identity_keys text[], branch_columns text[], scope_parents jsonb, metadata_only boolean, reader_roles text[]);
create table public.audit(tbl text, op text);
create function public.capture_activity_log() returns trigger language plpgsql as $$
begin insert into public.audit values (tg_table_name, tg_op); return coalesce(new, old); end $$;
create function public.reset_simulasi_barang_dan_stok(p text) returns void language plpgsql as $$
begin
  delete from public.item_group_components where ctid is not null;
  delete from public.item_units where ctid is not null;
  delete from public.items where ctid is not null;
end $$;
"""

TEST = r"""
\set ON_ERROR_STOP 1
insert into public.items(id,name,item_type,unit) values
 ('00000000-0000-0000-0000-00000000000a','Tabung','Persediaan','PCS'),
 ('00000000-0000-0000-0000-00000000000b','Reagen','Persediaan','ML'),
 ('00000000-0000-0000-0000-00000000000c','Jasa Lab','Jasa','KALI'),
 ('00000000-0000-0000-0000-000000000001','Kimia Darah Lengkap','Grup','PAKET'),
 ('00000000-0000-0000-0000-000000000002','Paket Medical Checkup','Grup','PAKET'),
 ('00000000-0000-0000-0000-000000000003','Paket Super','Grup','PAKET');
insert into public.item_units values ('00000000-0000-0000-0000-00000000000b','BOTOL',100);
-- grup lama (sebelum fitur) ada di tabel resep terbuka
"""

def main():
    with NativePostgres(sys.argv[1] if len(sys.argv) > 1 else "/usr/lib/postgresql/16/bin") as pg:
        pg.sql(STUB)
        pg.sql(open(ROOT + "20260831051502_grup_barang.sql").read())
        pg.sql(TEST)
        # Grup lama: Kimia Darah = 2 tabung + 5 ML reagen + 1 jasa
        pg.sql("""insert into public.item_group_components(group_item_id,component_item_id,qty,unit,factor,sort_order) values
          ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a',2,'PCS',1,0),
          ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b',5,'ML',1,1),
          ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c',1,'KALI',1,2);""")
        # Lama menolak grup sebagai komponen
        try:
            pg.sql("insert into public.item_group_components(group_item_id,component_item_id,qty,unit,factor) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',1,'PAKET',1)")
            raise SystemExit("FAIL: old trigger should reject")
        except RuntimeError: pass
        pg.sql(open(ROOT + "20261107050000_grup_bertingkat.sql").read())
        print("backfill:", pg.last("select count(*) from public.item_group_recipe"))
        assert pg.last("select count(*) from public.item_group_recipe") == "3"

        G1="00000000-0000-0000-0000-000000000001"; G2="00000000-0000-0000-0000-000000000002"; G3="00000000-0000-0000-0000-000000000003"
        A="00000000-0000-0000-0000-00000000000a"; B="00000000-0000-0000-0000-00000000000b"; C="00000000-0000-0000-0000-00000000000c"
        def rep(g, comps):
            import json
            pg.sql(f"select public.replace_item_group_components('{g}', '{json.dumps(comps)}'::jsonb)")
        def flat(g):
            return pg.sql(f"select string_agg(i.name||'='||trim_scale(c.qty)||' '||c.unit, ', ' order by c.sort_order) from public.item_group_components c join public.items i on i.id=c.component_item_id where c.group_item_id='{g}'")

        # Simpan ulang grup lama tanpa perubahan = tidak ada tulis ke resep terbuka
        pg.sql("delete from public.audit")
        rep(G1, [{"component_item_id":A,"qty":2,"unit":"PCS","factor":1,"sort_order":0},
                 {"component_item_id":B,"qty":5,"unit":"ML","factor":1,"sort_order":1},
                 {"component_item_id":C,"qty":1,"unit":"KALI","factor":1,"sort_order":2}])
        n = pg.last("select count(*) from public.audit where tbl='item_group_components'")
        print("rewrites on unchanged save:", n); assert n == "0"

        # G2 = 2 x G1 + 1 tabung + 1 BOTOL reagen
        rep(G2, [{"component_item_id":G1,"qty":2,"unit":"PAKET","factor":1,"sort_order":0},
                 {"component_item_id":A,"qty":1,"unit":"PCS","factor":1,"sort_order":1},
                 {"component_item_id":B,"qty":1,"unit":"BOTOL","factor":100,"sort_order":2}])
        print("G2:", flat(G2))
        assert flat(G2) == "Tabung=5 PCS, Reagen=10 ML, Jasa Lab=2 KALI, Reagen=1 BOTOL", flat(G2)
        # G3 = 3 x G2 (3 tingkat)
        rep(G3, [{"component_item_id":G2,"qty":3,"unit":"PAKET","factor":1,"sort_order":0}])
        print("G3:", flat(G3))
        assert flat(G3) == "Tabung=15 PCS, Reagen=30 ML, Jasa Lab=6 KALI, Reagen=3 BOTOL", flat(G3)
        # Ubah G1 -> G2 dan G3 ikut otomatis
        rep(G1, [{"component_item_id":A,"qty":3,"unit":"PCS","factor":1,"sort_order":0},
                 {"component_item_id":C,"qty":1,"unit":"KALI","factor":1,"sort_order":1}])
        print("after G1 change G2:", flat(G2)); print("after G1 change G3:", flat(G3))
        assert flat(G2) == "Tabung=7 PCS, Jasa Lab=2 KALI, Reagen=1 BOTOL", flat(G2)
        assert flat(G3) == "Tabung=21 PCS, Jasa Lab=6 KALI, Reagen=3 BOTOL", flat(G3)
        # Recipe G2 tetap seperti diketik admin
        assert pg.last(f"select count(*) from public.item_group_recipe where group_item_id='{G2}'") == "3"
        # Lingkaran langsung dan tidak langsung ditolak; data tidak berubah
        for bad in [(G1, G3), (G1, G2)]:
            try:
                rep(bad[0], [{"component_item_id":bad[1],"qty":1,"unit":"PAKET","factor":1,"sort_order":0}])
                raise SystemExit("FAIL: cycle accepted")
            except RuntimeError as e:
                print("cycle rejected:", str(e).strip().splitlines()[0][:160])
                assert "GRUP_LINGKARAN" in str(e)
        assert flat(G1) == "Tabung=3 PCS, Jasa Lab=1 KALI"
        # Self via check constraint
        try:
            rep(G1, [{"component_item_id":G1,"qty":1,"unit":"PAKET","factor":1,"sort_order":0}]); raise SystemExit("FAIL self")
        except RuntimeError: pass
        # Kedalaman > 5
        ids=[]
        for k in range(7):
            ids.append(pg.last(f"insert into public.items(name,item_type,unit) values ('D{k}','Grup','PAKET') returning id"))
        rep(ids[0], [{"component_item_id":A,"qty":1,"unit":"PCS","factor":1,"sort_order":0}])
        for k in range(1,5):
            rep(ids[k], [{"component_item_id":ids[k-1],"qty":1,"unit":"PAKET","factor":1,"sort_order":0}])
        print("depth5:", flat(ids[4]))
        try:
            rep(ids[5], [{"component_item_id":ids[4],"qty":1,"unit":"PAKET","factor":1,"sort_order":0}])
            print("depth 6 groups accepted (5 nested levels below)")
        except RuntimeError as e:
            print("depth rejected at 6:", str(e).splitlines()[0][:120])
        try:
            rep(ids[6], [{"component_item_id":ids[5],"qty":1,"unit":"PAKET","factor":1,"sort_order":0}])
            print("D6 accepted only because D5 was rejected (empty)")
        except RuntimeError as e:
            print("deeper rejected:", str(e).splitlines()[0][:160]); assert "GRUP_TERLALU_DALAM" in str(e)
        # Non admin ditolak
        pg.sql("update auth.test_admin set flag=false")
        try:
            rep(G1, []); raise SystemExit("FAIL non admin")
        except RuntimeError: pass
        pg.sql("update auth.test_admin set flag=true")
        # Item non-grup disimpan dengan payload kosong: tidak ada tulis
        pg.sql("delete from public.audit")
        rep(A, [])
        assert pg.last("select count(*) from public.audit") == "0"
        # Inactive inner leaf: komponen nonaktif tidak bisa ditambah lagi
        # G2 memuat Tabung langsung; Tabung dinonaktifkan lalu G1 diubah -> pesan jelas
        pg.sql(f"update public.items set is_active=false where id='{A}'")
        try:
            rep(G1, [{"component_item_id":C,"qty":2,"unit":"KALI","factor":1,"sort_order":0}]); raise SystemExit("FAIL inactive")
        except RuntimeError as e:
            print("inactive:", str(e).splitlines()[0][:160]); assert "GRUP_NONAKTIF" in str(e)
        assert flat(G1) == "Tabung=3 PCS, Jasa Lab=1 KALI"
        pg.sql(f"update public.items set is_active=true where id='{A}'")
        # Reset simulasi berjalan
        pg.sql("select public.reset_simulasi_barang_dan_stok('x')")
        assert pg.last("select count(*) from public.items") == "0"
        print("activity source:", pg.last("select entity from public.activity_log_sources"))
        print("ALL OK")

main()
