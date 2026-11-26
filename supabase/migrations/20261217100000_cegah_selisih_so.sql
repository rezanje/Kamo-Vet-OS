-- CEGAH-SELISIH-SO (Andri 26 Nov 2026, OPR.00012 Granada, Meo Pouch Adult/Kitten): selisih SO palsu karena baseline stok bergeser.
-- Apply as ONE transaction (seluruh file satu transaksi; file ini sengaja tanpa begin/commit sendiri).
-- Hanya posting BARU yang berubah. Hasil, jurnal, lapisan, mutasi, snapshot, dan stok lama (termasuk OPR.00012) TIDAK disentuh.
--
-- AKAR MASALAH (dibuktikan dari data Production 26 Nov)
--  Foto stok sistem (opname_counts.qty_sistem) ditulis saat barang DIKUNCI, tetapi tombol Buka menghapus barisnya (foto hilang). Kunci ulang sesudah
--  penjualan membuat foto BARU = stok sekarang. OPO.00013: Meo Pouch Adult/Kitten dikunci ulang 18:49 WIB (35-44 detik sebelum posting) dengan foto 0;
--  penjualan POS-20261124-0048 (Adult 11 + Kitten 1) sudah mengosongkan stok 17:56. Hitungan 11/1 dibanding foto 0 -> selisih lebih palsu +11/+1 (dinilai, dijurnal).
--
-- ATURAN (docs: DESIGN.md di bukti kerja; ringkas)
--  1. Selisih = hitungan - stok pada saat hitungan DIKUNCI PERTAMA di SO ini; stok akhir = stok sekarang + selisih (penjualan/terima/transfer di antaranya tidak disentuh).
--  2. Foto kunci pertama disimpan di tabel baru opname_count_baselines (trigger BEFORE DELETE pada opname_counts), jadi Buka + kunci ulang TIDAK menggesernya
--     (trigger BEFORE INSERT menimpa qty_sistem dengan foto pertama bila ada, kalau tidak dengan stok saat itu: tidak bisa dipalsukan klien; BEFORE UPDATE membekukannya).
--  3. Barang yang belum pernah dikunci: bila stoknya tidak bergerak sejak SO dimulai, baseline = stok sekarang (sama persis); bila sudah bergerak, posting DITOLAK
--     dengan pesan "tekan Kunci dulu" (jam hitung tidak diketahui, sistem tidak menebak).
--  4. Pemeriksaan "perlu diulang" (stok sekarang < kekurangan) tetap, pesannya diperjelas. Tidak pernah ada stok negatif baru.
--  5. Receipt/snapshot mendapat jejak barang yang bergerak sejak dihitung (bergerak_sejak_hitung, source_snapshot.sejak_hitung). Jurnal neto (PR #580),
--     kasbon neto, FIFO, kunci urutan, idempotensi: tidak berubah (selisih baris kini benar, semua turunan ikut benar).
--
-- ROLLBACK: pasang ulang definisi lama post_opname_atomic dari ROLLBACK.sql, drop trigger opname_counts_a_/b_/c_..., drop 3 fungsi trigger, drop table opname_count_baselines.

set local lock_timeout = '10s';

do $pre$ begin
 if to_regprocedure('public.post_opname_atomic(uuid,date,jsonb)') is null
  or to_regprocedure('public.guard_completed_opname_counts()') is null
  or to_regprocedure('public.opname_surplus_cost(uuid,uuid,numeric)') is null
  or to_regprocedure('public.opname_posting_journal(date,uuid,text,text,text,jsonb)') is null
  or to_regclass('public.opname_counts') is null or to_regclass('public.opname_orders') is null or to_regclass('public.stock_moves') is null
 then raise exception 'CEGAH_SELISIH_SO_SOURCE_CHANGED: kontrak posting opname tidak lengkap'; end if;
 if to_regclass('public.opname_count_baselines') is not null
  or position('CEGAH-SELISIH-SO' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))>0
  or position('hpp-rata-rata-v1' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))=0
 then raise exception 'CEGAH_SELISIH_SO_SOURCE_CHANGED: migrasi sudah terpasang atau definisi posting berbeda dari yang ditinjau'; end if;
end $pre$;

-- 1. Foto kunci PERTAMA per (opname, barang). Hanya fungsi DEFINER yang menulis/membaca; tidak ada hak untuk peran klien.
create table public.opname_count_baselines (
 order_id uuid not null references public.opname_orders(id) on delete cascade,
 item_id uuid not null references public.items(id) on delete cascade,
 qty_sistem numeric not null check (qty_sistem::text not in ('NaN','Infinity','-Infinity')),
 first_locked_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 primary key (order_id,item_id)
);
alter table public.opname_count_baselines enable row level security;
revoke all on table public.opname_count_baselines from public,anon,authenticated,service_role;
comment on table public.opname_count_baselines is 'Foto stok sistem pada kunci PERTAMA sebuah barang di satu opname; bertahan setelah Buka kunci. Selisih dihitung terhadap angka ini.';

-- 2. Buka kunci (DELETE) menyimpan foto pertama; yang pertama menang.
create function public.opname_counts_simpan_baseline() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.opname_orders o where o.id=old.order_id) then
  insert into public.opname_count_baselines(order_id,item_id,qty_sistem,first_locked_at)
   values(old.order_id,old.item_id,old.qty_sistem,old.locked_at) on conflict(order_id,item_id) do nothing;
 end if;
 return old;
end$$;
revoke all on function public.opname_counts_simpan_baseline() from public,anon,authenticated,service_role;

-- 3. Kunci / kunci ulang (INSERT): foto = foto pertama bila ada, kalau tidak stok saat ini. Server-otoritatif (klien tidak bisa memalsukan angka);
--    FOR SHARE pada baris stok mengurutkan dengan penjualan yang sedang berjalan (urutan kunci sama dengan posting: opname -> stok).
create function public.opname_counts_tetapkan_baseline() returns trigger
language plpgsql security definer set search_path='' as $$
declare base numeric;wh uuid;
begin
 select b.qty_sistem into base from public.opname_count_baselines b where b.order_id=new.order_id and b.item_id=new.item_id;
 if base is null then
  select o.warehouse_id into wh from public.opname_orders o where o.id=new.order_id;
  select s.qty into base from public.stock s where s.warehouse_id=wh and s.item_id=new.item_id for share;
  base:=coalesce(base,0);
 end if;
 new.qty_sistem:=base;
 return new;
end$$;
revoke all on function public.opname_counts_tetapkan_baseline() from public,anon,authenticated,service_role;

-- 4. Klien tidak boleh mengubah foto/jam kunci/identitas baris yang sudah ada (INVOKER: penulis DEFINER tidak terkena).
create function public.opname_counts_beku_foto() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') and (new.qty_sistem is distinct from old.qty_sistem or new.locked_at is distinct from old.locked_at
   or new.order_id is distinct from old.order_id or new.item_id is distinct from old.item_id) then
  raise exception 'Foto stok hitungan opname tidak boleh diubah. Buka kunci lalu kunci ulang bila hitungan perlu diganti.' using errcode='42501';
 end if;
 return new;
end$$;
revoke all on function public.opname_counts_beku_foto() from public,anon,authenticated,service_role;

-- Nama diurutkan setelah opname_completed_count_fence (pagar status opname mengunci induk lebih dulu).
create trigger opname_counts_a_tetapkan_baseline before insert on public.opname_counts for each row execute function public.opname_counts_tetapkan_baseline();
create trigger opname_counts_b_simpan_baseline before delete on public.opname_counts for each row execute function public.opname_counts_simpan_baseline();
create trigger opname_counts_c_beku_foto before update on public.opname_counts for each row execute function public.opname_counts_beku_foto();

-- 5. Tambalan jangkar eksak pada definisi yang sedang berjalan (tiap jangkar harus muncul tepat 1 kali; gagal tertutup).
do $patch$
declare p record; definition text; found_count integer;
begin
 definition := pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure);
 for p in select * from (values
  (1, $a$ recount text;
 sur_cost numeric;$a$,
   $a$ recount text;
 pending text;moved jsonb:='[]'::jsonb;
 sur_cost numeric;$a$),
  (2, $a$ perform 1 from public.stock where warehouse_id=wh.id and item_id=any(ids) order by item_id for update;
$a$,
   $a$ perform 1 from public.stock where warehouse_id=wh.id and item_id=any(ids) order by item_id for update;
 -- CEGAH-SELISIH-SO: hitungan yang BELUM pernah dikunci tidak punya jam hitung. Bila stok barangnya sudah bergerak sejak opname dimulai
 -- (terjual, masuk, atau pindah), sistem tidak boleh menebak hitungan itu dibuat sebelum atau sesudah pergerakan: minta dikunci dulu.
 select string_agg(i.name,', ' order by i.name) into pending
  from unnest(ids) as u(item_id) join public.items i on i.id=u.item_id
  where not exists(select 1 from public.opname_counts c where c.order_id=doc.id and c.item_id=u.item_id)
   and not exists(select 1 from public.opname_count_baselines b where b.order_id=doc.id and b.item_id=u.item_id)
   and exists(select 1 from public.stock_moves m where m.warehouse_id=wh.id and m.item_id=u.item_id and m.created_at>doc.created_at);
 if pending is not null then raise exception 'Barang berikut belum dikunci dan stoknya sudah bergerak (terjual, masuk, atau dipindah) sejak opname dimulai, jadi sistem tidak tahu hitungan itu dibuat sebelum atau sesudah pergerakan: %. Tekan Kunci pada barang tersebut tepat sesudah dihitung, lalu simpan lagi.',left(pending,600);end if;
$a$),
  (3, $a$'qty_sistem',coalesce(c.qty_sistem,s.qty),$a$,
   $a$'qty_sistem',coalesce(b.qty_sistem,c.qty_sistem,s.qty),$a$),
  (4, $a$-coalesce(c.qty_sistem,s.qty),'buy_price'$a$,
   $a$-coalesce(b.qty_sistem,c.qty_sistem,s.qty),'buy_price'$a$),
  (5, $a$left join public.opname_counts c on c.item_id=i.id and c.order_id=doc.id where i.id=any(ids);$a$,
   $a$left join public.opname_counts c on c.item_id=i.id and c.order_id=doc.id left join public.opname_count_baselines b on b.item_id=i.id and b.order_id=doc.id where i.id=any(ids);$a$),
  (6, $a$format('%s (dihitung %s, stok saat dikunci %s, stok sekarang %s)',x.name,trim_scale(x.qty_fisik),trim_scale(x.qty_sistem),trim_scale(s.qty))$a$,
   $a$format('%s (dihitung %s, stok saat dikunci %s, sejak itu berubah %s, stok sekarang %s)',x.name,trim_scale(x.qty_fisik),trim_scale(x.qty_sistem),trim_scale(s.qty-x.qty_sistem),trim_scale(s.qty))$a$),
  (7, $a$Buka kunci barang tersebut, hitung ulang fisiknya, lalu simpan lagi.'$a$,
   $a$Hitungan harus sama dengan isi rak PADA SAAT barang pertama kali dikunci (isi rak sekarang ditambah yang sudah terjual sejak itu), bukan isi rak sekarang. Bila hitungan pertama keliru: Buka kunci barang tersebut, isi hitungan yang benar, lalu simpan lagi. Bila barangnya memang kurang: Buka kunci tanpa mengisi ulang, simpan sisanya, lalu catat kekurangannya lewat Penyesuaian Persediaan.'$a$),
  (8, $a$ ref:=public.opname_posting_number('OPR',p_tanggal);$a$,
   $a$ -- CEGAH-SELISIH-SO: barang yang stoknya sudah bergerak sejak foto baseline (dihitung otomatis; selisih tetap = hitungan - foto).
 select coalesce(jsonb_agg(jsonb_build_object('item_id',x.item_id,'name',x.name,'qty_sistem',x.qty_sistem,'stok_sekarang',s.qty,'gerak',s.qty-x.qty_sistem) order by x.name,x.item_id),'[]'::jsonb) into moved
  from jsonb_to_recordset(rows) as x(item_id uuid,qty_sistem numeric,name text) join public.stock s on s.warehouse_id=wh.id and s.item_id=x.item_id where s.qty is distinct from x.qty_sistem;
 ref:=public.opname_posting_number('OPR',p_tanggal);$a$),
  (9, $a$'net_variance',round(loss-gain,2),'surplus_unpriced',unpriced);$a$,
   $a$'net_variance',round(loss-gain,2),'surplus_unpriced',unpriced,'bergerak_sejak_hitung',jsonb_array_length(moved));$a$),
  (10, $a$'invoice_value',0),je);$a$,
   $a$'invoice_value',0,'baseline_rule','kunci-pertama-v1','sejak_hitung',moved),je);$a$)
 ) as patches(n, old_text, new_text) loop
  found_count := (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text);
  if found_count <> 1 then
   raise exception 'CEGAH_SELISIH_SO: jangkar % harus muncul 1 kali (ditemukan %): %', p.n, found_count, left(p.old_text, 90);
  end if;
  definition := replace(definition, p.old_text, p.new_text);
 end loop;
 execute definition;
end $patch$;

-- create or replace mempertahankan ACL, tetapi ditegaskan ulang sesuai migrasi asal.
revoke all on function public.post_opname_atomic(uuid,date,jsonb) from public,anon,service_role;
grant execute on function public.post_opname_atomic(uuid,date,jsonb) to authenticated;

do $check$
declare d text := pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure);
begin
 if position('opname_count_baselines' in d)=0 or position('kunci-pertama-v1' in d)=0 or position('bergerak_sejak_hitung' in d)=0
  or position('Hitungan barang berikut perlu diulang' in d)=0 or position('s.qty<-x.selisih' in d)=0
  or position('coalesce(b.qty_sistem,c.qty_sistem,s.qty)' in d)=0
  or position('pending is not null' in d)>position('ref:=public.opname_posting_number' in d)
  or position('if recount is not null' in d)>position('ref:=public.opname_posting_number' in d) then
  raise exception 'CEGAH_SELISIH_SO: penanda tambalan tidak lengkap atau urutan pemeriksaan salah';end if;
 if not has_function_privilege('authenticated','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE')
  or has_function_privilege('public','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE') then
  raise exception 'CEGAH_SELISIH_SO: ACL posting opname salah';end if;
 if has_function_privilege('authenticated','public.opname_counts_simpan_baseline()','EXECUTE')
  or has_function_privilege('authenticated','public.opname_counts_tetapkan_baseline()','EXECUTE')
  or has_function_privilege('authenticated','public.opname_counts_beku_foto()','EXECUTE')
  or has_function_privilege('anon','public.opname_counts_simpan_baseline()','EXECUTE')
  or has_function_privilege('anon','public.opname_counts_tetapkan_baseline()','EXECUTE')
  or has_function_privilege('anon','public.opname_counts_beku_foto()','EXECUTE') then
  raise exception 'CEGAH_SELISIH_SO: fungsi trigger tidak boleh dipanggil klien';end if;
 if has_table_privilege('authenticated','public.opname_count_baselines','SELECT') or has_table_privilege('anon','public.opname_count_baselines','SELECT')
  or has_table_privilege('authenticated','public.opname_count_baselines','INSERT') or has_table_privilege('authenticated','public.opname_count_baselines','DELETE')
  or has_table_privilege('authenticated','public.opname_count_baselines','UPDATE') then
  raise exception 'CEGAH_SELISIH_SO: tabel baseline tidak boleh dapat diakses klien';end if;
end $check$;

-- Pagar Admin Online (#549): idempotent (tabel baru mendapat pagar baca+tulis; fungsi DEFINER baru diberi penjaga bila perlu).
select admin_online_private.guard_all();
select admin_online_private.fence_all();
