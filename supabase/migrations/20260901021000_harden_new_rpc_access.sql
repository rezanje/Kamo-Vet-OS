-- Default privileges proyek lama memberi EXECUTE langsung ke anon.
-- Tutup seluruh RPC baru, lalu buka hanya untuk pengguna login.
revoke all on function public.validate_item_group_component() from public, anon, authenticated;
revoke all on function public.touch_item_group_component() from public, anon, authenticated;

revoke all on function public.replace_item_group_components(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_item_group_components(uuid, jsonb) to authenticated;

revoke all on function public.delete_empty_group_item(uuid) from public, anon, authenticated;
grant execute on function public.delete_empty_group_item(uuid) to authenticated;

revoke all on function public.post_accurate_initial_stock(uuid) from public, anon, authenticated;
grant execute on function public.post_accurate_initial_stock(uuid) to authenticated;

revoke all on function public.replace_item_variant_family(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_item_variant_family(uuid, text, uuid, jsonb) to authenticated;

revoke all on function public.mark_booking_no_show(uuid) from public, anon, authenticated;
grant execute on function public.mark_booking_no_show(uuid) to authenticated;

revoke all on function public.record_visit_check_in(uuid) from public, anon, authenticated;
grant execute on function public.record_visit_check_in(uuid) to authenticated;

revoke all on function public.record_booking_visit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_booking_visit(uuid, uuid) to authenticated;

revoke all on function public.set_visit_service_state(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_visit_service_state(uuid, text, uuid) to authenticated;

revoke all on function public.create_visit_referral(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_visit_referral(uuid, text, text, text, text, timestamptz)
  to authenticated;
