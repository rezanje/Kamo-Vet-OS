<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Working with Reza

- Reza is non-technical. Use casual Indonesian (`gue`/`lo`), lead with business impact, and avoid raw logs or code unless requested.
- Resolve technical investigation independently. Surface user decisions only when they change scope, cost, risk, or timeline.
- Draft WhatsApp messages in natural, concise Indonesian when asked.

## VetOS context

- VetOS is a unified ERP for Kamo Group's veterinary-clinic and pet-shop operations.
- Finance, accounting, tax, payroll, inventory costing, and cross-branch data need especially careful verification. Never represent an unverified calculation, report, or migration as final.
- Multi-branch isolation through Supabase RLS is an architectural requirement. Do not replace it or materially change platform architecture without explicit approval.
- Treat product scope changes as possible contract-addendum work; call out impact before committing to a delivery promise.
- Existing repository code and dated documents under `docs/` and `Dokumen/` are source of truth. Imported Claude context is background only; dates, payments, implementation status, and external-service details may be stale.
