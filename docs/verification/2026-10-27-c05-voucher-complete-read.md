# C05 voucher complete read — 27 October 2026

This is a bounded C05 fix against main `4a36212` (which includes K03 PR 251 and the current C04 package mode). It does not close C05.

POS and clinical checkout previously loaded active voucher codes with one uncounted PostgREST request. When the number of codes exceeded the server response page, a valid later code was absent from the checkout display even though server posting resolves and validates the submitted code independently.

Both checkout display paths now use the shared counted list reader with stable ID ordering. If any page is missing, fails, or has a changed count, the list load fails instead of returning a partial result. Server validation, voucher rules, promotion calculations, and transaction posting are unchanged.

The synthetic 1,205-code fixture checks that a code on the last page is found and priced. A second fixture checks that a later-page failure rejects the complete read. No customer or production identifiers are used.

Campaign-code linkage to product promotions, creator permission, and usage limits still need business decisions. No database migration, production transaction, deployment, or field UAT is part of this verification.
