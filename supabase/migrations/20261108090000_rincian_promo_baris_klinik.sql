-- Rincian promo per barang di tagihan klinik (permintaan Reza, 8 Nov 2026).
--
-- "Setiap diskon produk ada informasi potongan rinciannya di struk, baris per produk
-- (mis. promo Icarae MBC). Yang di bawah khusus diskon transaksi."
--
-- Petshop sudah menyimpan promo per baris di sale_items (migrasi 0127). Klinik belum:
-- promo otomatis dihitung di server lalu dilebur ke invoices.discount bersama diskon
-- manual, golongan, voucher, dan poin. Struk tidak punya cara tahu promo mana yang
-- mengenai barang mana.
--
-- Tabel ini HANYA catatan tampilan/audit. Uangnya tetap di invoices.discount dan tidak
-- berubah sedikit pun: posting invoice, jurnal, DPP/PPN, insentif — semuanya tidak
-- membaca tabel ini. Itu sebabnya ditulis TERPISAH sesudah posting berhasil, bukan
-- menambal RPC posting klinik yang sudah berlapis-lapis. Kalau penulisan gagal atau
-- tabel belum ada, struk kembali ke tampilan lama (semua potongan di bawah) — angka
-- totalnya tetap benar.
--
-- Pagar: barisnya hanya bisa ditambah (tidak bisa diubah/dihapus pengguna), hanya untuk
-- invoice di cabang yang bisa diakses, invoice yang belum dibatalkan, dan jumlah seluruh
-- potongan promo satu invoice tidak boleh melebihi total diskon invoice itu.

create table if not exists public.invoice_promo_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  -- Barang/jasa yang kena promo. Sengaja tanpa FK: catatan tampilan tidak boleh
  -- menghalangi master barang dirapikan.
  item_id uuid not null,
  promo_id uuid not null,
  -- Nama promo saat transaksi (snapshot): promo boleh diganti nama/dihapus kemudian,
  -- struk lama tetap mencetak nama yang berlaku waktu itu.
  promo_name text not null check (length(btrim(promo_name)) between 1 and 200),
  potongan numeric(15,2) not null check (potongan > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint invoice_promo_lines_unik unique (invoice_id, item_id, promo_id)
);

comment on table public.invoice_promo_lines is
  'Rincian promo otomatis per barang di invoice klinik — tampilan struk/invoice saja; uangnya tetap di invoices.discount. Diisi sejak 8 Nov 2026.';

alter table public.invoice_promo_lines enable row level security;
revoke all on public.invoice_promo_lines from public, anon, authenticated;
grant select, insert on public.invoice_promo_lines to authenticated;

drop policy if exists invoice_promo_lines_baca on public.invoice_promo_lines;
create policy invoice_promo_lines_baca on public.invoice_promo_lines for select to authenticated
  using (exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
    where i.id=invoice_promo_lines.invoice_id and public.user_can_access_branch(v.branch_id)));

drop policy if exists invoice_promo_lines_tambah on public.invoice_promo_lines;
create policy invoice_promo_lines_tambah on public.invoice_promo_lines for insert to authenticated
  with check (exists(select 1 from public.invoices i join public.visits v on v.id=i.visit_id
    where i.id=invoice_promo_lines.invoice_id and i.voided_at is null
      and public.user_can_access_branch(v.branch_id)));

-- Jumlah promo satu invoice tidak boleh melebihi diskon invoice-nya. Dijalankan sebagai
-- pemilik fungsi karena pengguna tidak punya hak UPDATE (dan karenanya tidak bisa
-- mengunci) baris invoices; kunci baris mencegah dua sisipan bersamaan sama-sama lolos.
create or replace function public.guard_invoice_promo_lines() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare
  v_discount numeric;
  v_voided timestamptz;
  v_sudah numeric;
begin
  select i.discount, i.voided_at into v_discount, v_voided
    from public.invoices i where i.id = new.invoice_id for update;
  if not found then
    raise exception using errcode='P0001', message='PROMO_LINE_INVOICE: invoice tidak ditemukan';
  end if;
  if v_voided is not null then
    raise exception using errcode='P0001', message='PROMO_LINE_VOID: invoice sudah dibatalkan';
  end if;
  -- Ulangan permintaan yang sama (kirim ulang setelah respons hilang): baris yang sama
  -- dilewati diam-diam, bukan dihitung dua kali lalu ditolak.
  if exists(select 1 from public.invoice_promo_lines p where p.invoice_id = new.invoice_id
      and p.item_id = new.item_id and p.promo_id = new.promo_id) then
    return null;
  end if;
  select coalesce(sum(p.potongan), 0) into v_sudah
    from public.invoice_promo_lines p where p.invoice_id = new.invoice_id;
  if v_sudah + new.potongan > coalesce(v_discount, 0) + 0.01 then
    raise exception using errcode='P0001', message='PROMO_LINE_LEBIH: rincian promo melebihi diskon invoice';
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$function$;
revoke all on function public.guard_invoice_promo_lines() from public, anon, authenticated;

drop trigger if exists invoice_promo_lines_guard on public.invoice_promo_lines;
create trigger invoice_promo_lines_guard before insert on public.invoice_promo_lines
  for each row execute function public.guard_invoice_promo_lines();

create index if not exists invoice_promo_lines_invoice_idx on public.invoice_promo_lines(invoice_id);
