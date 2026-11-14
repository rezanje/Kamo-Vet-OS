-- Struk WA otomatis setelah pembayaran untuk SEMUA kasir + saklar struk sendiri.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Latar (Aldi, 14 Nov 2026): "Kalau bisa saat klik pembayaran langsung direct ke wa gitu mas jadi mau ga mau dia kirim."
-- Reza memilih opsi A: struk dikirim otomatis dari nomor WA klinik (bukan dari HP kasir).
--
-- Temuan: struk WA klinik sudah ada sejak 0136/0138, tetapi riwayat WA (whatsapp_message_log) hanya boleh ditulis
-- OWNER/ADMIN. Kasir biasa yang menekan Bayar gagal mencatat log → struk diam-diam tidak pernah dikirim.
-- Selain itu struk ikut saklar utama pengingat retensi (is_enabled), padahal itu dua hal berbeda.
--
-- RANCANGAN
--  * wa_engine_settings.receipt_enabled — saklar struk WA sendiri (bawaan NYALA). Owner/Admin bisa mematikan di Pengaturan WA.
--  * public.wa_struk_catat(...) SECURITY DEFINER: akun aktif mana pun boleh mencatat SATU log struk ('receipt:<nomor>')
--    hanya untuk nomor transaksi yang memang ada (sales.no_struk / invoices.invoice_no) dan nomor HP yang sama dengan
--    data pelanggan. Duplikat (nomor sama) mengembalikan NULL = sudah pernah diproses (anti dobel kirim).
--  * public.wa_struk_tandai(...) SECURITY DEFINER: hanya menandai log struk berstatus 'queued' jadi sent/failed.
--  * RLS tabel riwayat WA TIDAK dilonggarkan: staf tetap tidak bisa membaca/menulis riwayat langsung.

alter table public.wa_engine_settings add column if not exists receipt_enabled boolean not null default true;
comment on column public.wa_engine_settings.receipt_enabled is
 'Kirim struk pembayaran otomatis ke WA pelanggan (kasir toko, POS, klinik, rawat inap). Terpisah dari pengingat retensi (is_enabled).';

create or replace function public.wa_struk_catat(
  p_ref text, p_customer_id uuid, p_branch_id uuid, p_phone text, p_message text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_phone text;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Akun tidak aktif; struk WA tidak dicatat' using errcode = '42501';
  end if;
  if p_ref is null or length(btrim(p_ref)) = 0 or length(p_ref) > 160
     or p_customer_id is null or p_phone is null or length(btrim(p_phone)) = 0 or length(p_phone) > 30
     or p_message is null or length(btrim(p_message)) = 0 or length(p_message) > 4000 then
    raise exception 'Data struk WA tidak valid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.sales where no_struk = p_ref and customer_id = p_customer_id)
     and not exists (select 1 from public.invoices i join public.visits v on v.id = i.visit_id
                     where i.invoice_no = p_ref and v.customer_id = p_customer_id) then
    raise exception 'Transaksi struk WA tidak ditemukan' using errcode = '22023';
  end if;
  select phone into v_phone from public.customers where id = p_customer_id;
  if v_phone is null or btrim(v_phone) <> btrim(p_phone) then
    raise exception 'Nomor WA tidak sesuai data pelanggan' using errcode = '22023';
  end if;

  insert into public.whatsapp_message_log (customer_id, branch_id, trigger_key, idempotency_key, phone, message)
  values (p_customer_id, p_branch_id, 'receipt', 'receipt:' || p_ref, btrim(p_phone), p_message)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.wa_struk_tandai(p_log_id uuid, p_sent boolean, p_error text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Akun tidak aktif; status struk WA tidak dicatat' using errcode = '42501';
  end if;
  update public.whatsapp_message_log
     set status = case when p_sent then 'sent' else 'failed' end,
         sent_at = case when p_sent then now() else null end,
         error = case when p_sent then null else left(coalesce(nullif(btrim(p_error), ''), 'Gagal kirim'), 500) end
   where id = p_log_id and trigger_key = 'receipt' and status = 'queued';
  return found;
end $$;

revoke all on function public.wa_struk_catat(text, uuid, uuid, text, text) from public, anon;
revoke all on function public.wa_struk_tandai(uuid, boolean, text) from public, anon;
grant execute on function public.wa_struk_catat(text, uuid, uuid, text, text) to authenticated;
grant execute on function public.wa_struk_tandai(uuid, boolean, text) to authenticated;
