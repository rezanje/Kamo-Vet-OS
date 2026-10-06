# Purchase transaction recovery

Receipt quantities, numbered receipt details, FIFO stock, per-receipt GRNI journal, and PO status must commit together. Reject unknown/duplicate rows, invalid quantities, batches, or unit conversions rather than assuming missing rows arrived. Preserve damaged-goods claims and purchase layer references to the PO for existing partial-invoice repricing.

Each receipt, PO invoice, and cash/bank asset purchase requires a stable client submission key. Identical retries return original identifiers; changing the business payload under the same key fails. Recover an invoice before remaining-quantity checks or recalculating its cost-layer plan. Recheck current module and branch authorization on every operation and recovery using existing Akses Grup defaults and overrides. Preserve existing invoice status, amount, source and funding rules. No dependency upgrades, remote writes, backfills, or draft expiry policies.

Test with fictional data on an isolated PostgreSQL 16 container and real server-action code with only infrastructure mocked. Exercise staged multisatuan receipts, partial invoices, rollback on stock/journal failure, duplicate/conflicting retries, current authorization, and concurrent requests.

Browser storage keeps a tab-local request identity only. A read-only check-last-submission action can recover the actor's prior result even when refreshed receipt quantities or derived invoice plans differ. Confirmed success retires only that key and rotates a form kept mounted by same-page navigation.
