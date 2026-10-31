#!/bin/bash
# start/stop local PG17 replica cluster (unix socket only)
set -e
PG17=/nix/store/vync24csmxy5saql5ah77vkn59yg2x5h-postgresql-17.11/bin
W=/opt/data/${REPLICA:-kamo-replica}
PORT=${REPLICA_PORT:-54399}
case "$1" in
 init) rm -rf $W; mkdir -p $W/sock; chown -R postgres $W
   runuser -u postgres -- $PG17/initdb -D $W/data -U postgres -E UTF8 --locale=C.UTF-8 -A trust >/dev/null
   printf "listen_addresses=''\nunix_socket_directories='$W/sock'\nport=$PORT\ntimezone='Etc/UTC'\nmax_locks_per_transaction=1024\nshared_buffers=256MB\n" >> $W/data/postgresql.conf
   runuser -u postgres -- $PG17/pg_ctl -D $W/data -l $W/log -w start >/dev/null; echo started;;
 start) runuser -u postgres -- $PG17/pg_ctl -D $W/data -l $W/log -w start;;
 stop) runuser -u postgres -- $PG17/pg_ctl -D $W/data -m fast -w stop;;
 psql) shift; $PG17/psql -X -h $W/sock -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 "$@";;
esac
