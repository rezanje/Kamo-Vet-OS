-- Auto-konfirmasi email akun baru — dashboard Supabase versi ini tidak menampilkan
-- toggle "Confirm email", jadi dipaksa di level DB. Aman: VetOS = ERP internal,
-- akun hanya dibuat admin lewat Pengaturan → Manajemen Pengguna (tidak ada signup publik).
create or replace function public.auto_confirm_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;
revoke execute on function public.auto_confirm_new_user() from anon, authenticated;

create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function public.auto_confirm_new_user();
