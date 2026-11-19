-- Ubah pembayaran penjualan satu langkah (migrasi *_ubah_pembayaran_penjualan). Data fiktif; semuanya di-rollback.
-- Dijalankan SETELAH bagian fixture + helper supabase/tests/backdate_petshop.sql (sampai penanda "-- ── 0. objek baru"),
-- yang membuka transaksi dan menyiapkan cabang BP satu, kasir, shift, akun per metode (1111 Tunai, 1112 Transfer, 1115 QRIS, ...).
create function pg_temp.change(ref text,key text,plan jsonb,d date default null,reason text default 'Salah catat pembayaran',rev integer default null) returns jsonb language sql as $$
 select change_pos_sale_payment(pg_temp.sid(ref),coalesce(rev,pg_temp.rev(ref)),key,reason,plan,d)$$;
create function pg_temp.methods(ref text) returns text language sql security definer as $$
 select string_agg(p.method||'='||p.amount::numeric(14,0),',' order by p.method) from public.sale_payments p where p.sale_id=pg_temp.sid($1)$$;
create function pg_temp.open_cancel(ref text) returns boolean language sql security definer as $$
 select exists(select 1 from public.pos_receipt_cancellations where sale_id=pg_temp.sid($1) and closed_at is null)$$;
create function pg_temp.cycles(ref text) returns integer language sql security definer as $$
 select count(*)::int from public.pos_receipt_cancellations where sale_id=pg_temp.sid($1)$$;
create function pg_temp.njr() returns integer language sql security definer as $$select count(*)::int from public.journal_entries$$;

select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok(to_regprocedure('public.change_pos_sale_payment(uuid,integer,text,text,jsonb,date)') is not null,'UP fungsi ubah pembayaran ada');
select pg_temp.ok(has_function_privilege('authenticated','public.change_pos_sale_payment(uuid,integer,text,text,jsonb,date)','execute')
 and not has_function_privilege('anon','public.change_pos_sale_payment(uuid,integer,text,text,jsonb,date)','execute'),'UP hak jalan: authenticated ya, anon tidak');

-- Struk kasir: 3 hari lalu tunai 100000; 2 hari lalu tunai 50000; hari ini tunai 80000.
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('UP.1','[{"method":"Tunai","amount":100000}]');
select pg_temp.mk('UP.2','[{"method":"Tunai","amount":50000}]');
select pg_temp.mk('UP.3','[{"method":"Tunai","amount":80000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('UP.1',3);select pg_temp.age('UP.2',2);
insert into fz select 'UP.1',pg_temp.frozen('UP.1');

-- 1. Ganti metode + tanggal bayar sekaligus: tunai (3 hari lalu) -> transfer (kemarin).
select pg_temp.ok((pg_temp.change('UP.1','up1',jsonb_build_array(jsonb_build_object('method','Transfer','amount',100000)),pg_temp.today()-1,'Pelanggan transfer kemarin, kasir catat tunai')
 ->>'mode')='ubah-pembayaran','UP1 ubah pembayaran tersimpan dalam satu langkah');
select pg_temp.ok(not pg_temp.open_cancel('UP.1') and pg_temp.cycles('UP.1')=1,'UP1 struk tidak pernah tertinggal belum dibayar (siklus tertutup)');
select pg_temp.ok(pg_temp.methods('UP.1')='Transfer=100000' and pg_temp.rev('UP.1')=1,'UP1 pembayaran sekarang Transfer 100000, revisi naik 1');
select pg_temp.ok(pg_temp.jdate('UP.1','sale-receipt-cancel')=pg_temp.today()-3 and pg_temp.jdate('UP.1','sale-receipt-repost')=pg_temp.today()-1,'UP1 pembalik di tanggal pembayaran asli (3 hari lalu), penerimaan baru di tanggal pilihan (kemarin)');
select pg_temp.ok(pg_temp.net_on('UP.1','1111',pg_temp.today()-3)=0 and pg_temp.net_on('UP.1','1112',pg_temp.today()-1)=100000 and pg_temp.net('UP.1','150001')=0,'UP1 buku besar: kas hari asli 0, transfer kemarin +100000, piutang 0');
select pg_temp.ok(pg_temp.frozen('UP.1')=(select h from fz where ref='UP.1'),'UP1 isi struk, stok, HPP, jurnal penjualan, poin tidak berubah');
select pg_temp.ok((select reason like 'Ubah pembayaran: %' and receive_reason='Pelanggan transfer kemarin, kasir catat tunai' and closed_kind='diterima-ulang' from pos_receipt_cancellations where sale_id=pg_temp.sid('UP.1')),'UP1 riwayat: alasan tercatat, ditandai ubah pembayaran');

-- 2. Klik dua kali / koneksi putus: kunci sama = hasil sama, tanpa jurnal tambahan; isian beda dengan kunci sama ditolak.
create temp table up_j as select pg_temp.njr() n;
select pg_temp.ok(pg_temp.change('UP.1','up1',jsonb_build_array(jsonb_build_object('method','Transfer','amount',100000)),pg_temp.today()-1,'Pelanggan transfer kemarin, kasir catat tunai',0)->>'journal_id'
 =(select receive_journal_id::text from pos_receipt_cancellations where sale_id=pg_temp.sid('UP.1')) and pg_temp.njr()=(select n from up_j),'UP2 ulang kirim: hasil sama, tidak ada jurnal baru');
select pg_temp.reject($q$select pg_temp.change('UP.1','up1','[{"method":"QRIS","amount":100000}]',pg_temp.today()-1,'Pelanggan transfer kemarin, kasir catat tunai',0)$q$,'isian berbeda','UP2 kunci sama dengan isian berbeda ditolak');

-- 3. Tidak ada perubahan ditolak; tanggal sebelum pembayaran tercatat ditolak; jumlah tidak sama total ditolak — semuanya tanpa efek.
select pg_temp.reject($q$select pg_temp.change('UP.1','up3a','[{"method":"Transfer","amount":100000}]',pg_temp.today()-1)$q$,'Tidak ada yang berubah','UP3 isian sama persis ditolak');
select pg_temp.reject($q$select pg_temp.change('UP.2','up3b','[{"method":"QRIS","amount":50000}]',pg_temp.today()-3)$q$,'tidak boleh sebelum tanggal pembayaran','UP3 tanggal bayar sebelum pembayaran asli ditolak');
select pg_temp.reject($q$select pg_temp.change('UP.2','up3c','[{"method":"QRIS","amount":40000}]',pg_temp.today()-1)$q$,'sama dengan total struk','UP3 jumlah tidak sama total ditolak');
select pg_temp.reject($q$select pg_temp.change('UP.2','up3d','[{"method":"QRIS","amount":50000}]',pg_temp.today()+1)$q$,'belum tiba','UP3 tanggal masa depan ditolak');
select pg_temp.reject($q$select pg_temp.change('UP.2','up3e','[{"method":"QRIS","amount":50000}]',null,'ab')$q$,'alasan','UP3 alasan terlalu pendek ditolak');
select pg_temp.ok(pg_temp.cycles('UP.2')=0 and pg_temp.methods('UP.2')='Tunai=50000' and pg_temp.rev('UP.2')=0,'UP3 penolakan tidak meninggalkan jejak (atomik): struk tetap lunas tunai');

-- 4. Hanya tanggal bayar yang berubah (metode sama): jurnal pindah tanggal, revisi tetap.
select pg_temp.change('UP.2','up4','[{"method":"Tunai","amount":50000}]',pg_temp.today()-1,'Uang disetor besoknya');
select pg_temp.ok(pg_temp.net_on('UP.2','1111',pg_temp.today()-2)=0 and pg_temp.net_on('UP.2','1111',pg_temp.today()-1)=50000 and pg_temp.rev('UP.2')=0 and not pg_temp.open_cancel('UP.2'),'UP4 tanggal saja: kas pindah dari 2 hari lalu ke kemarin, revisi tetap');

-- 5. Struk hari ini dibagi dua metode; lalu diubah lagi (siklus kedua) tetap bisa.
select pg_temp.change('UP.3','up5a','[{"method":"Tunai","amount":30000},{"method":"QRIS","amount":50000}]',null,'Sebagian bayar QRIS');
select pg_temp.ok(pg_temp.methods('UP.3')='QRIS=50000,Tunai=30000' and pg_temp.net('UP.3','1115')=50000 and pg_temp.net('UP.3','1111')=30000,'UP5 split tunai + QRIS');
select pg_temp.change('UP.3','up5b','[{"method":"QRIS","amount":80000}]',null,'Ternyata QRIS semua');
select pg_temp.ok(pg_temp.methods('UP.3')='QRIS=80000' and pg_temp.net('UP.3','1111')=0 and pg_temp.cycles('UP.3')=2 and not pg_temp.open_cancel('UP.3'),'UP5 diubah lagi: QRIS semua, dua siklus tercatat');

-- 6. Kasir biasa (tanpa izin) ditolak; tanpa izin tanggal mundur hanya bisa hari ini.
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select pg_temp.change('UP.2','up6','[{"method":"QRIS","amount":50000}]')$q$,'tidak diizinkan','UP6 kasir tanpa izin ditolak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
-- Struk yang penerimaannya sedang dibatalkan (dua langkah lama) tidak bisa diubah satu langkah: pakai Terima pembayaran.
select pg_temp.cancel('UP.2','up7c','Batal manual');
select pg_temp.reject($q$select pg_temp.change('UP.2','up7','[{"method":"QRIS","amount":50000}]')$q$,'sudah dibatalkan','UP7 struk yang sedang belum dibayar diarahkan ke Terima pembayaran');

select pg_temp.ok(pg_temp.bal_by_date(),'UP neraca saldo nol per cabang per tanggal');
select 'UBAH PEMBAYARAN PASS';
rollback;
