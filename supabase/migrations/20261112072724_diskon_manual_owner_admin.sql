-- Diskon manual hanya untuk Owner/Admin (permintaan Aldi, grup Kamo 12 Nov 2026: "Yg diskon jangan dikasih ke karyawan mas biar akun admin ajh").
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Sebelumnya siapa pun yang bisa membuka kasir (termasuk STAFF) bisa mengetik potongan per barang / diskon total di kasir petshop
-- dan diskon % per baris / diskon total di tagihan klinik; tidak ada pembatas peran.
--
-- RANCANGAN:
--  * Satu izin Akses Grup baru 'kasir.diskon_manual' (izin khusus, diatur Owner di Pengaturan > Akses Grup).
--  * OWNER selalu boleh (tidak membaca tabel kebijakan, jadi tidak bisa terkunci).
--  * Peran TANPA kebijakan tindakan tersimpan ("legacy"): hanya ADMIN yang boleh (bawaan permintaan Aldi). STAFF/DOCTOR/FINANCE tidak.
--  * Peran DENGAN kebijakan tersimpan: boleh hanya bila Owner mencentang izin ini untuk peran tersebut.
--  * Yang TIDAK dibatasi: promo, voucher, kode kampanye, poin, diskon golongan member, dan diskon bawaan barang dari master
--    (items.default_discount) — semuanya ditentukan master/sistem, bukan diketik kasir.
--  * Pemeriksaan dipakai server aplikasi sebelum menyimpan transaksi (kasir petshop dua layar + pembayaran klinik).
--  * Tidak ada perubahan pada data lama, jurnal, stok, atau struk yang sudah ada.

set local lock_timeout = '5s';

insert into role_settings_private.action_catalog(id,label,"group",enforced) values
 ('kasir.diskon_manual','Beri diskon manual — potongan per barang / diskon total di kasir petshop dan diskon tagihan klinik (promo, voucher, poin, diskon member, dan diskon bawaan barang tetap jalan otomatis)','Kasir & Tagihan',true)
on conflict(id) do nothing;
insert into role_settings_private.action_modules(id,module_id) values('kasir.diskon_manual','kasir') on conflict do nothing;

create function public.manual_discount_allowed() returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_role public.user_role; v_allowed text[];
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
 select role into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null then return false; end if;
 -- OWNER: tidak membaca tabel kebijakan sama sekali, jadi galat/penguncian kebijakan tidak bisa menolaknya.
 if v_role='OWNER' then return true; end if;
 begin
  if not exists(select 1 from role_settings_private.action_catalog where id='kasir.diskon_manual' and enforced) then return false; end if;
  select a.allowed into v_allowed from role_settings_private.action_policies a where a.role=v_role;
  -- Tanpa kebijakan tersimpan: bawaan hanya ADMIN.
  if not found then return v_role='ADMIN'; end if;
  return 'kasir.diskon_manual'=any(v_allowed);
 exception when others then return false;
 end;
end $$;
comment on function public.manual_discount_allowed() is 'Boleh memberi diskon manual di kasir/tagihan? OWNER selalu; peran legacy hanya ADMIN; peran berkebijakan bila dicentang (kasir.diskon_manual).';
revoke all on function public.manual_discount_allowed() from public,anon,service_role;
grant execute on function public.manual_discount_allowed() to authenticated;
