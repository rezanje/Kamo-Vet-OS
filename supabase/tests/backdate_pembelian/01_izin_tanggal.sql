-- 01 Izin tanggal mundur + aturan tanggal satu pintu: katalog, bawaan MATI untuk selain Owner, Owner tidak pernah terkunci, ACL,
-- pintu aturan (masa depan, sebelum dokumen asal, izin, alasan, periode akuntansi, Closing HPP), tabel bukti tidak bisa diubah.
select pg_temp.su();
select pg_temp.ok((select count(*)=1 from role_settings_private.action_catalog where id='pembelian.tanggal_mundur' and enforced and "group"='Pembelian'),'katalog: tindakan tanggal mundur ditegakkan');
select pg_temp.ok((select count(*)=1 from role_settings_private.action_modules where id='pembelian.tanggal_mundur' and module_id='pembelian'),'tindakan terpetakan ke modul pembelian');
select pg_temp.ok((select count(*)=0 from role_settings_private.action_policies),'tidak ada kebijakan tersimpan (bawaan)');
select pg_temp.ok((select count(*)=0 from purchase_backdate_audit),'tabel bukti kosong saat dipasang');

-- Bawaan: OWNER boleh; ADMIN/FINANCE/STAFF tidak.
select pg_temp.act(1);
select pg_temp.ok(purchase_cancel_allowed('pembelian.tanggal_mundur') and get_my_purchase_backdate_access(),'Owner boleh tanggal mundur');
select pg_temp.ok(get_my_purchase_cancel_access()=jsonb_build_object('batalkan_penerimaan',true,'batalkan_faktur',true,'batalkan_pembayaran',true,'batalkan_uang_muka',true),'bentuk JSON akses pembatalan lama tidak berubah');
select pg_temp.act(2);
select pg_temp.ok(not purchase_cancel_allowed('pembelian.tanggal_mundur') and not get_my_purchase_backdate_access(),'ADMIN tanpa izin: tidak boleh');
select pg_temp.act(3);
select pg_temp.ok(not get_my_purchase_backdate_access(),'FINANCE tanpa izin: tidak boleh');
select pg_temp.act(4);
select pg_temp.ok(not get_my_purchase_backdate_access(),'STAFF tidak boleh');
-- Izin hanya lewat Akses Grup; memberi izin lain (batal penerimaan) tidak ikut memberi tanggal mundur.
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan']);
select pg_temp.act(2);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and not get_my_purchase_backdate_access(),'izin batal penerimaan tidak memberi tanggal mundur');
select pg_temp.grant_role('ADMIN',array['pembelian.tanggal_mundur']);
select pg_temp.act(2);
select pg_temp.ok(get_my_purchase_backdate_access(),'izin tanggal mundur eksplisit berlaku');
select pg_temp.reset_role_access('ADMIN');
select pg_temp.act(2);
select pg_temp.ok(not get_my_purchase_backdate_access(),'kembali ke bawaan: mati');

-- Owner tidak pernah terkunci: tabel kebijakan rusak (diganti nama) tidak mengubah jawaban Owner; peran lain gagal-tertutup.
select pg_temp.su();
alter table role_settings_private.action_policies rename to action_policies_rusak;
select pg_temp.act(1);
select pg_temp.ok(get_my_purchase_backdate_access(),'Owner tetap boleh walau tabel kebijakan rusak');
select pg_temp.act(2);
select pg_temp.ok(not get_my_purchase_backdate_access(),'ADMIN gagal-tertutup walau tabel kebijakan rusak');
select pg_temp.su();
alter table role_settings_private.action_policies_rusak rename to action_policies;

-- ACL: pembantu internal tidak bisa dipanggil klien; tabel bukti tidak bisa ditulis/dibaca langsung; RPC daftar hanya peran keuangan.
select pg_temp.act(1);
do $$ begin
 begin perform purchase_effective_date_check('receipt-cancel',current_date,null,'x','dok',false); raise exception 'pembantu tanggal bisa dipanggil klien';
 exception when insufficient_privilege then null; end;
 begin perform purchase_backdate_record('receipt-cancel',gen_random_uuid(),'x',null,current_date,null,'x',null,'k'); raise exception 'pencatat bukti bisa dipanggil klien';
 exception when insufficient_privilege then null; end;
 begin perform purchase_assert_fifo_order(gen_random_uuid(),gen_random_uuid(),current_date,null); raise exception 'pemeriksa FIFO bisa dipanggil klien';
 exception when insufficient_privilege then null; end;
 begin perform purchase_layer_consumers_text(array[gen_random_uuid()]); raise exception 'teks pemakai bisa dipanggil klien';
 exception when insufficient_privilege then null; end;
 begin perform purchase_replacement_floor_receipt(gen_random_uuid()); raise exception 'pembantu lantai bisa dipanggil klien';
 exception when insufficient_privilege then null; end;
 begin perform count(*) from purchase_backdate_audit; raise exception 'tabel bukti bisa dibaca langsung';
 exception when insufficient_privilege then null; end;
 begin insert into purchase_backdate_audit(kind,doc_id,actor_id,effective_date,actual_date,days_back) values('receipt-cancel',gen_random_uuid(),auth.uid(),current_date,current_date,0); raise exception 'tabel bukti bisa ditulis klien';
 exception when insufficient_privilege then null; end;
end $$;
select pg_temp.ok((select count(*)=0 from list_purchase_backdate_audit(10,false)),'Owner boleh membaca daftar (kosong)');
select pg_temp.act(4);
select pg_temp.expect_error('select * from list_purchase_backdate_audit(10,false)','hanya untuk Owner, Admin, dan Finance');
select pg_temp.act(3);
select pg_temp.ok((select count(*)=0 from list_purchase_backdate_audit(10,true)),'Finance boleh membaca daftar');
select pg_temp.expect_error('select * from list_purchase_backdate_audit(0,false)','Batas daftar tidak valid');
select pg_temp.su();
set local role anon;
do $$ begin
 begin perform * from list_purchase_backdate_audit(1,false); raise exception 'anon boleh membaca daftar';
 exception when insufficient_privilege then null; end;
 begin perform get_my_purchase_backdate_access(); raise exception 'anon boleh membaca izin';
 exception when insufficient_privilege then null; end;
end $$;
select pg_temp.su();

-- Pintu aturan tanggal (dipanggil sebagai pemilik fungsi, jawaban peran tetap dari klaim sesi).
select pg_temp.act(1);
select pg_temp.su();
select pg_temp.expect_error('select purchase_effective_date_check(''x'',null,null,''alasan'',''dok'',false)','Tanggal wajib diisi');
select pg_temp.expect_error('select purchase_effective_date_check(''x'',''infinity''::date,null,''alasan'',''dok'',false)','Tanggal wajib diisi');
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date+1,null,''alasan'',''dok'',false)','masa depan');
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date-3,current_date-2,''alasan'',''pembayaran'',false)','sebelum tanggal pembayaran asal');
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date-1,null,'' a '',''dok'',false)','Alasan wajib diisi');
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date-1,null,null,''dok'',false)','Alasan wajib diisi');
select purchase_effective_date_check('x',current_date,null,null,'dok',false);
select purchase_effective_date_check('x',current_date-1,current_date-1,'alasan sah','dok',true);
-- tanggal hari ini tidak butuh alasan atau izin (peran ADMIN tanpa izin tetap boleh hari ini)
select pg_temp.act(2);
select pg_temp.su();
select purchase_effective_date_check('x',current_date,null,null,'dok',true);
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date-1,null,''alasan sah'',''dok'',false)','hanya untuk Owner atau peran yang diberi izin Tanggal mundur');
-- periode akuntansi dikunci
select pg_temp.act(1);
select pg_temp.su();
update accounting_locks set closed_until=current_date-3;
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date-3,null,''alasan sah'',''dok'',false)','Periode akuntansi sampai');
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date-3,null,''alasan sah'',''dok'',false)','Keuangan > Tutup Buku');
select purchase_effective_date_check('x',current_date-2,null,'alasan sah','dok',false);
update accounting_locks set closed_until=null;
-- Closing HPP: hanya untuk aksi yang menyentuh stok
update inventory_costing_settings set closed_through=current_date-3 where id;
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date-3,null,''alasan sah'',''dok'',true)','Closing HPP');
select pg_temp.expect_error('select purchase_effective_date_check(''x'',current_date-3,null,''alasan sah'',''dok'',true)','Keuangan > Closing HPP');
select purchase_effective_date_check('x',current_date-3,null,'alasan sah','dok',false);
select purchase_effective_date_check('x',current_date-2,null,'alasan sah','dok',true);
update inventory_costing_settings set closed_through=null where id;

-- Tabel bukti tidak bisa diubah/dihapus walau oleh pemilik fungsi.
insert into purchase_backdate_audit(kind,doc_id,actor_id,effective_date,actual_date,days_back) values('receipt-cancel',gen_random_uuid(),'bd000000-0000-4000-8000-000000000001',current_date-1,current_date,1);
select pg_temp.expect_error('update purchase_backdate_audit set reason=''x''','tidak bisa diubah atau dihapus');
select pg_temp.expect_error('delete from purchase_backdate_audit','tidak bisa diubah atau dihapus');
select pg_temp.expect_error('truncate purchase_backdate_audit','tidak bisa diubah atau dihapus');
select pg_temp.ok((select days_back=1 from purchase_backdate_audit),'bukti utuh');
select pg_temp.expect_error('insert into purchase_backdate_audit(kind,doc_id,actor_id,effective_date,actual_date,days_back) values(''bukan-jenis'',gen_random_uuid(),gen_random_uuid(),current_date,current_date,0)','violates check constraint');
select pg_temp.expect_error('insert into purchase_backdate_audit(kind,doc_id,actor_id,effective_date,actual_date,days_back) values(''receipt-cancel'',gen_random_uuid(),gen_random_uuid(),current_date,current_date,-1)','violates check constraint');
select pg_temp.tb_zero('01 selesai');
