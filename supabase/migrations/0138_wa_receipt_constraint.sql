-- Struk WA adalah notifikasi transaksi, terpisah dari tujuh trigger retensi.
alter table whatsapp_message_log drop constraint if exists whatsapp_message_log_trigger_key_check;
alter table whatsapp_message_log add constraint whatsapp_message_log_trigger_key_check check (trigger_key in (
  'post_grooming', 'post_treatment', 'vaccination_due', 'vaccination_overdue',
  'lapsed', 'owner_birthday', 'pet_birthday', 'receipt'
));
