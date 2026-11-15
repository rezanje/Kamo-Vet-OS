-- D2 (meeting 12 Nov 2026): FILTER RETENSI — pelanggan yang tidak datang dalam N bulan (CRM › Pelanggan).
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Hanya fungsi BACA baru. Tidak ada tabel/kolom/data yang diubah.
--  * "Datang" = transaksi petshop/online yang tidak dibatalkan (sales.created_at, voided_at null) ATAU kunjungan klinik yang tidak
--    diarsipkan (visits.created_at; termasuk riwayat klinik hasil impor yang bertanggal asli sejak 2024).
--  * Pelanggan yang tidak pernah datang sama sekali TIDAK ikut (bukan sasaran retensi; mis. kartu baru tanpa transaksi).
--  * Catatan data: penjualan petshop di VetOS baru ada sejak 1 Nov 2026 (riwayat petshop sistem lama tidak diimpor), jadi pelanggan
--    yang hanya belanja petshop sebelum itu belum terbaca "pernah datang".
--  * Menghitung lintas SEMUA cabang (security definer): kunjungan dibatasi per cabang untuk staf, dan tanpa ini pelanggan yang
--    datang ke cabang lain akan salah terbaca "tidak datang". Yang dikembalikan hanya baris pelanggan (sudah boleh dibaca semua
--    akun aktif lewat RLS customers_read) dan tanggal terakhir datang; tidak ada isi transaksi.
--
-- public.pelanggan_tidak_datang(p_bulan) -> setof customers  : dipakai seperti tabel (filter cari, urutan, halaman, hitung).
-- public.pelanggan_terakhir_datang(p_ids) -> (customer_id, terakhir_datang) : tanggal terakhir untuk maks. 200 pelanggan di layar.
--
-- ROLLBACK: drop function public.pelanggan_tidak_datang(integer), public.pelanggan_terakhir_datang(uuid[]);
set local lock_timeout='5s';

create function public.pelanggan_aktivitas_terakhir() returns table(customer_id uuid, terakhir_datang timestamptz)
language sql stable security definer set search_path='' as $$
 select a.customer_id, max(a.t) from (
  select s.customer_id, max(s.created_at) t from public.sales s where s.customer_id is not null and s.voided_at is null group by 1
  union all
  select v.customer_id, max(v.created_at) from public.visits v where v.customer_id is not null and v.archived_at is null group by 1
 ) a group by 1
$$;
revoke all on function public.pelanggan_aktivitas_terakhir() from public,anon,authenticated,service_role;

create function public.pelanggan_tidak_datang(p_bulan integer) returns setof public.customers
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
  raise exception using errcode='42501', message='RETENSI_DITOLAK: perlu akun aktif.';
 end if;
 if p_bulan is null or p_bulan<1 or p_bulan>60 then
  raise exception using errcode='22023', message='RETENSI_BULAN: jumlah bulan 1 sampai 60.';
 end if;
 return query
  select c.* from public.customers c
  join public.pelanggan_aktivitas_terakhir() a on a.customer_id=c.id
  where a.terakhir_datang < now() - make_interval(months => p_bulan);
end $$;
comment on function public.pelanggan_tidak_datang(integer) is 'D2: pelanggan yang pernah datang (petshop/online/klinik) tetapi terakhir datang lebih dari p_bulan bulan lalu.';
revoke all on function public.pelanggan_tidak_datang(integer) from public,anon,service_role;
grant execute on function public.pelanggan_tidak_datang(integer) to authenticated;

create function public.pelanggan_terakhir_datang(p_ids uuid[]) returns table(customer_id uuid, terakhir_datang timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then
  raise exception using errcode='42501', message='RETENSI_DITOLAK: perlu akun aktif.';
 end if;
 if p_ids is null or cardinality(p_ids)>200 then
  raise exception using errcode='22023', message='RETENSI_DAFTAR: maksimal 200 pelanggan sekali baca.';
 end if;
 return query
  select x.customer_id, max(x.t) from (
   select s.customer_id, max(s.created_at) t from public.sales s where s.customer_id=any(p_ids) and s.voided_at is null group by 1
   union all
   select v.customer_id, max(v.created_at) from public.visits v where v.customer_id=any(p_ids) and v.archived_at is null group by 1
  ) x group by 1;
end $$;
revoke all on function public.pelanggan_terakhir_datang(uuid[]) from public,anon,service_role;
grant execute on function public.pelanggan_terakhir_datang(uuid[]) to authenticated;
