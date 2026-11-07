-- Order online boleh memakai gudang cabang mana pun (permintaan Aldi, 5 Nov 2026 16.22 & 16.43):
-- "gudangnya kita sekarang pakai gudang petshop saja sama cabang petshop" dan "online bisa pilih
-- cabang dan gudang semua dulu, biar bisa input manual".
--
-- Sebelumnya post_online_order hanya menerima gudang bertipe ONLINE. Sekarang semua gudang aktif
-- diterima KECUALI gudang EXPIRED (barang kedaluwarsa) dan TRANSIT (barang dalam perjalanan) —
-- dua jenis itu bukan stok jual. Cabang tetap mengikuti gudang yang dipilih (wh.branch_id), dan
-- akses cabang tetap diperiksa unit_posting_access. Perhitungan stok, HPP, jurnal, dan piutang
-- marketplace tidak berubah.
--
-- Pola tambalan sama dengan 20261023182000: ganti satu jangkar sumber yang sudah ditinjau,
-- identitas/kepemilikan/ACL fungsi tetap; gagal keras bila definisi di database berbeda.
do $patch$ declare definition text; anchor text; replacement text; signature text;
begin
 signature:='public.post_online_order(text,jsonb,jsonb)';
 definition:=pg_get_functiondef(signature::regprocedure);
 anchor:=$anchor$ select * into wh from public.warehouses where id=(p_header->>'warehouse_id')::uuid and type='ONLINE' and is_active for share;
 if not found then raise exception 'Gudang online tidak ditemukan';end if;$anchor$;
 replacement:=$replacement$ select * into wh from public.warehouses where id=(p_header->>'warehouse_id')::uuid and type not in ('EXPIRED','TRANSIT') and is_active for share;
 if not found then raise exception 'Gudang tidak ditemukan atau tidak bisa dipakai untuk order online';end if;$replacement$;
 if position(replacement in definition)>0 then
  return; -- sudah terpasang
 end if;
 if position(anchor in definition)=0 or length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
  raise exception 'ONLINE_WAREHOUSE_SCHEMA_DRIFT: %',signature;
 end if;
 execute replace(definition,anchor,replacement);
end $patch$;
