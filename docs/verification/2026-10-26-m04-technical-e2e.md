# M04 synthetic import check

`RUN_M04_E2E=1 ./node_modules/.bin/vitest run src/lib/__tests__/m04-technical-e2e.test.ts` builds a fictional Accurate workbook in memory and parses both the item and opening-stock sheets with the application parsers. It resolves the branch, warehouse, units, and a rejected row, then posts to an owned disposable PostgreSQL 16 container through the same prepare, preview, and post functions used by the application.

The test first rejects fractional cents in strict mode. It then explicitly selects batch half-up normalization, reads the saved preview in a new database connection, verifies the rejected row reason, retries preparation and posting with the same keys, and checks one posted run and one balanced journal. It compares stock, layers, movements, and value for each fictional SKU and warehouse. The fixture expects two valid rows and one rejected row; no customer workbook, production database, or real import is used.

This is a technical integration test of the parsers and database posting path. Browser continuation tests cover the page controls separately with mocked action boundaries; this test does not claim an actual browser-to-database run or field simulation. Earlier verification of the application server actions is recorded in `2026-10-22-actual-import-file.md` and `2026-10-22-recoverable-inventory-import.md`.
