# Verified operational-reset backup

Local implementation and independent specification/quality review passed. No live backup or live reset is evidenced by this report.

The service-only preparation RPC persists a complete public-table snapshot in a private schema. It records table data, columns/defaults/constraints/user-trigger modes, sequences, and auth UUID references. Auth accounts and storage objects remain intact during the separately planned reset; this is not an auth/storage disaster recovery export. Application OWNER sessions cannot download private posting/request data.

The administrative downloader must save the returned document text byte-for-byte, privately, and preserve its SHA256. The verifier creates only a unique localhost database, applies all repository migrations, restores every public row with temporary user-trigger suspension and deferred foreign keys, validates constraints, restores original trigger and constraint modes/sequences, and compares every manifest hash and count. It then drops its owned test database. Inherited PostgreSQL connection settings are stripped for creation, bootstrap, restore and cleanup.

`python3 scripts/test-simulation-backup-postgres.py` passed actual restoration of financial/private posting data, medical examination/inpatient history, and 1,001 UTF-8 attachment references. It also passed unauthorized export denial, wrong-checksum rejection, exact manifest validation and test-database cleanup. The same suite passed with hostile `PGHOSTADDR`, nonexistent `PGSERVICE`, and read-only inherited `PGOPTIONS`.

Independent specification and quality review approved the three backup implementation/test files. The separate reset operation still needs its own review, production backup, production download verification and actual restored-production-data receipt before deletion.

Connection isolation follows [PostgreSQL environment-variable documentation](https://www.postgresql.org/docs/current/libpq-envars.html).
