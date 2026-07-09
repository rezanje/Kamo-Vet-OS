-- Gudang DC/Transit = tujuan bersama permintaan barang lintas cabang. RLS branch-isolation
-- (warehouses_select = user_can_access_branch) menyembunyikannya dari staff cabang, padahal
-- mereka perlu memilihnya sebagai tujuan. Policy tambahan (OR): tipe DC/TRANSIT terlihat semua.
create policy warehouses_select_shared on warehouses
  for select to authenticated
  using (type in ('DC', 'TRANSIT'));
