"""Throwaway native PostgreSQL cluster for fictional-fixture tests (no Docker, no DB URL).

initdb into a short temp dir, unix socket only, removed on exit. Run as root, it uses the `postgres`
OS user. `bin_dir` holds initdb/pg_ctl/postgres; psql is taken from there or else from PATH
(a newer server with an older psql client is fine for these SQL checks).
"""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


class NativePostgres:
    def __init__(self, bin_dir):
        self.bin = Path(bin_dir)
        psql = self.bin / "psql"
        self.psql = str(psql) if psql.exists() else shutil.which("psql")
        assert self.psql, "psql not found"

    def __enter__(self):
        self.root = Path(tempfile.mkdtemp(prefix="pgk.", dir="/opt/data"))
        self.as_user = ["runuser", "-u", "postgres", "--"] if os.geteuid() == 0 else []
        if self.as_user:
            shutil.chown(self.root, "postgres")
        self.run(self.bin / "initdb", "-D", self.root / "data", "-U", "postgres", "-E", "UTF8", "--locale=C.UTF-8", "-A", "trust")
        self.run(self.bin / "pg_ctl", "-D", self.root / "data", "-l", self.root / "log", "-w", "start",
                 "-o", f"-c listen_addresses='' -k {self.root} -c timezone=Etc/UTC -c shared_buffers=128MB -c max_connections=20")
        return self

    def __exit__(self, *_):
        subprocess.run(self.as_user + [str(self.bin / "pg_ctl"), "-D", str(self.root / "data"), "-m", "fast", "-w", "stop"], capture_output=True)
        shutil.rmtree(self.root, ignore_errors=True)
        print("Stopped and removed the throwaway PostgreSQL cluster.", flush=True)

    def run(self, *args):
        subprocess.run(self.as_user + [str(a) for a in args], check=True, capture_output=True)

    def sql(self, source):
        result = subprocess.run(self.as_user + [self.psql, "-X", "-qAt", "-h", str(self.root), "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
                                input=source, text=True, capture_output=True, env={**os.environ, "PSQLRC": "/dev/null"})
        if result.returncode:
            raise RuntimeError(result.stderr + result.stdout)
        return result.stdout.strip()

    def last(self, source):
        return self.sql(source).splitlines()[-1]
