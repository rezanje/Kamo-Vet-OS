S=/tmp/claude-0/-home-user-Kamo-Vet-OS/8951f758-6e5a-530d-9f68-09d7403b622a/scratchpad
need=""
for i in $(seq 1 40); do
  PATCH_ONLY="$need" python3 $S/gen_reset.py DRYRUN $S/rd_try.sql >/dev/null
  out=$($S/replica.sh psql -q -f $S/rd_try.sql 2>&1)
  if echo "$out" | grep -q DRYRUN_OK; then echo "NEEDED: $need"; exit 0; fi
  fn=$(echo "$out" | grep -o 'PL/pgSQL function [a-z_.]*' | grep -v inline_code_block | head -1 | awk '{print $3}' | sed 's/^public\.//')
  msg=$(echo "$out" | grep ERROR | head -1 | cut -c1-200)
  echo "blocked by $fn :: $msg"
  [ -z "$fn" ] && { echo "$out" | head -5; exit 1; }
  need="$need,$fn"
done
