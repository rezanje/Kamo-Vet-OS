Independent read-only review: /root/k08_review, explicitly requested Sol6.1 high.

Initial P2: app-only paid-checkout recovery could race concurrent inpatient admission/correction because predicates and checkout were separate requests. Actual action mock reproduced successful checkout after inpatient state changed. That endpoint and button were removed entirely.

Final review: no remaining P1/P2. Current-function atomic checkout patch holds existing visit lock, preserves early retry return/security/ACL, and avoids changing split/DEMO base semantics. Single and group application checkout calls removed. Guarded reverse patch and roundtrip checked. Sales balance fix agrees with existing group reader. Historical status warnings and paired app/DB release caveats retained.

Reviewer independently ran40 focused tests and read312 files/2440 full tests passing. Final local SQL5/5 completion was confirmed by implementer after review; reviewer did not claim to have run it. No target access or changes by reviewer.
