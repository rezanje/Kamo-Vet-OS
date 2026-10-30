#!/usr/bin/env node
// Mengukur berapa perjalanan bolak-balik yang dibutuhkan folder rekam medis sebesar
// 2.000 kartu / 20.000 riwayat, sebelum dan sesudah impor mengalir.
//
//   node scripts/ukur-impor-rekam-medis.mjs
import { spawnSync } from "node:child_process";

const hasil = spawnSync("npx", [
  "vitest", "run",
  "src/lib/__tests__/impor-rekam-medis-aliran.test.ts",
  "-t", "perjalanan bolak-balik",
  "--pool=forks", "--maxWorkers=1", "--reporter=verbose",
], { stdio: "inherit", env: { ...process.env, UKUR_IMPOR_LOG: "1" } });

process.exit(hasil.status ?? 1);
