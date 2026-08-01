-- Jasa tidak boleh punya stok — dikunci di database, bukan di aplikasi.
--
-- Latar 2026-08-01: ditemukan 2 baris stok milik barang berjenis Jasa
-- (Konsultasi Dokter +1, Grooming Standar -3). Satu jalur penyebabnya sudah
-- diperbaiki (e97445d, retur jasa), tapi perbaikan di satu tempat tidak
-- mencegah jalur berikutnya melakukan hal yang sama.
--
-- Ditaruh sebagai trigger, bukan pengecekan di setiap server action:
-- stok ditulis dari banyak tempat (penjualan, penerimaan, pemindahan, opname,
-- retur, racikan) dan yang berikutnya belum tentu ingat aturan ini.

create or replace function public.tolak_stok_non_persediaan()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  jenis text;
  nama  text;
begin
  select i.item_type, i.name into jenis, nama from public.items i where i.id = new.item_id;
  if jenis is not null and jenis <> 'Persediaan' then
    raise exception 'Barang "%" berjenis % — tidak punya stok, jadi tidak bisa dicatat masuk/keluar gudang', nama, jenis
      using hint = 'Ubah jenis barang jadi Persediaan kalau memang stoknya dilacak.';
  end if;
  return new;
end $$;

create trigger stock_tolak_non_persediaan
  before insert or update on stock
  for each row execute function public.tolak_stok_non_persediaan();

create trigger stock_layers_tolak_non_persediaan
  before insert or update on stock_layers
  for each row execute function public.tolak_stok_non_persediaan();

comment on function public.tolak_stok_non_persediaan is
  'Jasa & Non-Persediaan tidak punya stok. Menahan di sini menutup SEMUA jalur tulis stok sekaligus.';
