-- 01 Izin pembatalan: katalog, bawaan MATI untuk selain Owner, Owner tidak pernah terkunci, ACL, penegakan di keempat RPC.
select pg_temp.su();
-- Katalog Akses Grup: empat tindakan baru, ditegakkan, modul pembelian.
select pg_temp.ok((select count(*)=4 from role_settings_private.action_catalog where id like 'pembelian.batalkan_%' and enforced and "group"='Pembelian'),'empat tindakan pembelian ditegakkan di katalog');
select pg_temp.ok((select count(*)=4 from role_settings_private.action_modules where id like 'pembelian.batalkan_%' and module_id='pembelian'),'empat tindakan terpetakan ke modul pembelian');
select pg_temp.ok((select count(*)=0 from role_settings_private.action_policies),'tidak ada kebijakan tindakan tersimpan (bawaan)');

-- Bawaan: OWNER boleh, selain Owner TIDAK (walau tidak ada kebijakan tersimpan).
select pg_temp.act(1);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and purchase_cancel_allowed('pembelian.batalkan_faktur') and purchase_cancel_allowed('pembelian.batalkan_pembayaran') and purchase_cancel_allowed('pembelian.batalkan_uang_muka'),'owner boleh semua');
select pg_temp.ok(get_my_purchase_cancel_access()=jsonb_build_object('batalkan_penerimaan',true,'batalkan_faktur',true,'batalkan_pembayaran',true,'batalkan_uang_muka',true),'ringkasan akses owner');
select pg_temp.act(2);
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_penerimaan') and not purchase_cancel_allowed('pembelian.batalkan_faktur'),'ADMIN tanpa kebijakan: tidak boleh (bawaan MATI)');
select pg_temp.ok(get_my_purchase_cancel_access()=jsonb_build_object('batalkan_penerimaan',false,'batalkan_faktur',false,'batalkan_pembayaran',false,'batalkan_uang_muka',false),'ringkasan akses ADMIN mati');
select pg_temp.act(3);
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_penerimaan'),'FINANCE tanpa kebijakan: tidak boleh');
select pg_temp.act(4);
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_penerimaan'),'STAFF tidak boleh');
select pg_temp.ok(not purchase_cancel_allowed('tindakan.tak.dikenal'),'tindakan tak dikenal ditolak');
select pg_temp.ok(not purchase_cancel_allowed(null),'tindakan kosong ditolak');

-- Kebijakan eksplisit memuat tindakan = boleh; tindakan lain tetap tidak.
select pg_temp.su();
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan','pembelian.batalkan_pembayaran']);
select pg_temp.act(2);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and purchase_cancel_allowed('pembelian.batalkan_pembayaran'),'ADMIN diberi izin: boleh');
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_faktur') and not purchase_cancel_allowed('pembelian.batalkan_uang_muka'),'izin lain tetap mati');
select pg_temp.su();
select id as other_action from role_settings_private.action_catalog c where c.enforced and c.id not like 'pembelian.batalkan_%' and exists(select 1 from role_settings_private.action_modules m where m.id=c.id and m.module_id in ('pembelian','kas-bank')) order by id limit 1 \gset
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan',:'other_action']);
select pg_temp.act(2);
select pg_temp.ok(not purchase_cancel_allowed(:'other_action'),'tindakan lain di kebijakan ADMIN tidak dianggap izin batal');
select pg_temp.act(3);
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_penerimaan'),'izin ADMIN tidak bocor ke FINANCE');
-- Peran dinonaktifkan: tidak boleh.
select pg_temp.su();
update profiles set is_active=false where id='bd000000-0000-4000-8000-000000000002';
select pg_temp.act(2);
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_penerimaan'),'akun nonaktif tidak boleh');
select pg_temp.su();
update profiles set is_active=true where id='bd000000-0000-4000-8000-000000000002';

-- Owner tidak pernah terkunci walau kebijakan tidak terbaca; selain Owner gagal-tertutup.
select pg_temp.su();
alter table role_settings_private.action_policies rename to action_policies_hilang;
select pg_temp.act(1);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and purchase_cancel_allowed('pembelian.batalkan_uang_muka'),'OWNER tetap boleh saat tabel kebijakan tidak terbaca');
select pg_temp.act(2);
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_penerimaan'),'ADMIN gagal-tertutup saat kebijakan tidak terbaca');
select pg_temp.su();
alter table role_settings_private.action_policies_hilang rename to action_policies;

-- ACL: hanya authenticated; anon dan service_role tidak.
select pg_temp.su();
select pg_temp.ok(has_function_privilege('authenticated','public.purchase_cancel_allowed(text)','execute') and not has_function_privilege('anon','public.purchase_cancel_allowed(text)','execute')
 and not has_function_privilege('service_role','public.purchase_cancel_allowed(text)','execute'),'ACL purchase_cancel_allowed');
select pg_temp.ok(has_function_privilege('authenticated','public.get_my_purchase_cancel_access()','execute') and not has_function_privilege('anon','public.get_my_purchase_cancel_access()','execute'),'ACL get_my_purchase_cancel_access');
select pg_temp.ok(has_function_privilege('authenticated','public.preview_goods_receipt_cancellation(uuid,date)','execute') and not has_function_privilege('anon','public.preview_goods_receipt_cancellation(uuid,date)','execute'),'ACL preview');
select pg_temp.ok(has_function_privilege('authenticated','public.reopen_purchase_order_remainder(uuid,text,text)','execute') and not has_function_privilege('anon','public.reopen_purchase_order_remainder(uuid,text,text)','execute'),'ACL reopen');
select pg_temp.ok(not has_table_privilege('authenticated','public.purchase_order_receipt_closure_reopenings','insert') and not has_table_privilege('authenticated','public.purchase_order_receipt_closure_reopenings','update')
 and not has_table_privilege('authenticated','public.purchase_order_receipt_closure_reopenings','delete') and not has_table_privilege('anon','public.purchase_order_receipt_closure_reopenings','select'),'arsip pembukaan: klien hanya baca');

-- Penegakan: peran diberi izin penerimaan boleh membatalkan penerimaan; yang tidak diberi (STAFF/FINANCE/ADMIN tanpa izin) ditolak,
-- dan penolakan tidak meninggalkan efek apa pun.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(1,'cap-r1','[{"line":1,"qty":4}]') as rid \gset
select pg_temp.age(:'rid'::uuid, interval '2 hour');
select pg_temp.act(1);
select pg_temp.recv(1,'cap-r2','[{"line":1,"qty":3}]') as rid2 \gset
select pg_temp.act(3);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'rid','cap-fin','Coba'),'hanya oleh Super Admin');
select pg_temp.act(4);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'rid','cap-staff','Coba'),'hanya oleh Super Admin');
select pg_temp.reset_role_access('ADMIN');
select pg_temp.act(2);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'rid','cap-adm-off','Coba'),'hanya oleh Super Admin');
select pg_temp.expect_error(format('select reopen_purchase_order_remainder(%L,%L,%L)',pg_temp.po(1),'cap-reopen-off','Coba'),'hanya oleh Super Admin');
select pg_temp.ok(not (select voided_at is not null from goods_receipts where id=:'rid'::uuid),'penolakan tidak membatalkan');
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan']);
select pg_temp.act(2);
select pg_temp.ok(cancel_goods_receipt(:'rid'::uuid,'cap-adm-on','Salah input jumlah')?'reversal_journal_id','ADMIN yang diberi izin berhasil membatalkan penerimaan');
select pg_temp.ok((select voided_by from goods_receipts where id=:'rid'::uuid)='bd000000-0000-4000-8000-000000000002','aktor ADMIN tercatat');
select pg_temp.invariants('kapabilitas');
