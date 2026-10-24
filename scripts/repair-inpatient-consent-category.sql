-- Bounded repair for the signed "ranap" document reported on 2026-10-22.
-- Privileged maintenance only. The legacy inpatient demo template was created
-- as Umum. Correct classification, never the signed text/signature/identity.
-- Deliberately exclude the surgery document made with the same demo template.
begin;
set local lock_timeout = '5s';
lock table public.consent_templates, public.consents in access exclusive mode;
create temporary table consent_category_before on commit drop as
  select id, to_jsonb(c) as document from public.consents c;
create temporary table consent_template_before on commit drop as
  select id, to_jsonb(t) as document from public.consent_templates t;

do $$ begin
  if not exists(select 1 from public.consent_templates
    where id='42d95502-5383-4492-b72f-228f82cb9b55'
      and nama='DEMO - Persetujuan Rawat Inap (Simulasi)'
      and kategori in ('Umum','Rawat Inap') and is_active)
    or (select count(*) from public.consents
      where template_id='42d95502-5383-4492-b72f-228f82cb9b55'
        and kategori in ('Umum','Rawat Inap') and (
          (id='c05d337e-12d1-4d66-9438-504fe8129605' and tindakan='ranap' and status='sudah_ttd'
            and nullif(btrim(signature_data),'') is not null and signed_at is not null)
          or (id='7216fa3f-a38b-430c-a848-bba70cbf5e38' and tindakan='Rawat Inap' and status='belum_ttd')
        )) <> 2 then
    raise exception 'Expected inpatient template/documents changed; re-inspect before repair';
  end if;
end $$;

update public.consent_templates set kategori='Rawat Inap'
where id='42d95502-5383-4492-b72f-228f82cb9b55' and kategori='Umum';
-- The application guard correctly locks signed documents. This exclusive,
-- transactional maintenance exception changes only the two verified categories.
alter table public.consents disable trigger consent_document_guard;
update public.consents set kategori='Rawat Inap'
where id in ('c05d337e-12d1-4d66-9438-504fe8129605','7216fa3f-a38b-430c-a848-bba70cbf5e38')
  and kategori='Umum';
alter table public.consents enable trigger consent_document_guard;

do $$ begin
  if exists(
    select 1 from consent_category_before b full join public.consents c using(id)
    where case when b.id in ('c05d337e-12d1-4d66-9438-504fe8129605','7216fa3f-a38b-430c-a848-bba70cbf5e38')
      then b.document - 'kategori' is distinct from to_jsonb(c) - 'kategori'
        or c.kategori is distinct from 'Rawat Inap'
      else b.document is distinct from to_jsonb(c) end
  ) or exists(
    select 1 from consent_template_before b full join public.consent_templates t using(id)
    where case when b.id='42d95502-5383-4492-b72f-228f82cb9b55'
      then b.document - 'kategori' is distinct from to_jsonb(t) - 'kategori'
        or t.kategori is distinct from 'Rawat Inap'
      else b.document is distinct from to_jsonb(t) end
  ) then raise exception 'Unexpected change to document content or unrelated rows'; end if;
  if not exists(select 1 from pg_trigger
    where tgrelid='public.consents'::regclass and tgname='consent_document_guard' and tgenabled='O')
  then raise exception 'Signature guard must remain enabled'; end if;
  if not exists(select 1 from public.consents c
    where c.id='c05d337e-12d1-4d66-9438-504fe8129605'
      and c.status='sudah_ttd' and c.kategori='Rawat Inap'
      and not exists(select 1 from public.consent_rules r
        where r.kategori='Rawat Inap' and r.wajib and r.template_id is not null
          and r.template_id<>c.template_id))
  then raise exception 'Repaired signature does not satisfy inpatient admission'; end if;
end $$;
select true as inpatient_consent_recognized,
  true as signed_content_and_unrelated_documents_unchanged,
  true as signature_guard_enabled;
commit;
