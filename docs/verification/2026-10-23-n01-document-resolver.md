# N01: exact saved document resolution

Base main `61376d7736dc1669925f4214f1a978e30a053750`. The shared `/dokumen/<number>` resolver correctly found stored IDs, then discarded them for sales invoices, sales returns, purchase returns, goods receipts and sales advances. The first four now open their existing detail route; advances target the existing `advance-<id>` row anchor. Clinical invoices retain their stored visit-ID routing.

A source lookup error previously fell through to other document types or claimed the document did not exist. Resolution now stops and reports an unconfirmed lookup without exposing database errors. A genuine no-match message refers to accessible documents and the active branch, without asserting deletion. Existing authenticated source queries, RLS and destination guards are unchanged.

Six failing cases reproduced before the fix. Afterward 37 focused resolver/navigation tests across four files passed; TypeScript and scoped lint passed. Narrow independent review found no P1/P2. Exact-head Vercel preview is the production build gate for this small route-only change; no redundant full local app suite/build or hosted financial simulation. No migration or business-data mutation. Rollback is a code revert.

N01 global remains partial: this does not add missing job/compound/refund relations or infer documents without stored identifiers. No J03 points policy is changed.
