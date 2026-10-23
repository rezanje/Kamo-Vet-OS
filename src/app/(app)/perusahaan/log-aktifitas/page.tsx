import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SecHeader } from '@/components/SecHeader';
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITIES, ACTIVITY_MODULES, ACTIVITY_PAGE_SIZE, ACTIVITY_PATH, activityFilters, activityHref, activityObjectHref, type ActivityParams, type ActivityRow } from '@/lib/activity-log';

const formatTime = (s: string) => new Date(s).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'medium' }) + ' WIB';
const value = (v: unknown) => v === undefined ? '—' : v === null ? 'kosong' : typeof v === 'boolean' ? v ? 'Ya' : 'Tidak' : String(v);

export default async function ActivityLogPage({ searchParams }: { searchParams: Promise<ActivityParams> }) {
  const filters = activityFilters(await searchParams);
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: profile } = user ? await db.from('profiles').select('role,is_active').eq('id', user.id).maybeSingle() : { data: null };
  if (!profile?.is_active || !['OWNER', 'ADMIN'].includes(profile.role)) {
    return <div className="p2ban" role="alert">Log aktivitas tersedia untuk OWNER/ADMIN aktif sesuai akses modul dan cabang yang berlaku.</div>;
  }

  let query = db.from('activity_log')
    .select('id,occurred_at,actor_id,actor_name,actor_kind,module_id,entity,entity_id,object_label,row_entity,row_id,action,changed_fields,before_state,after_state')
    .order('id', { ascending: !!filters.after }).limit(ACTIVITY_PAGE_SIZE + 1);
  if (filters.object) query = query.contains('object_refs', [{ entity: filters.entity, id: filters.object }]);
  else if (filters.entity) query = query.contains('object_entities', [filters.entity]);
  if (filters.module) query = query.eq('module_id', filters.module);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.q) query = query.ilike('object_label', '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%');
  if (filters.from) query = query.gte('occurred_at', filters.from + 'T00:00:00+07:00');
  if (filters.to) query = query.lte('occurred_at', filters.to + 'T23:59:59.999999+07:00');
  if (filters.before) query = query.lt('id', filters.before);
  if (filters.after) query = query.gt('id', filters.after);
  const { data, error } = await query;
  const result = (data ?? []) as ActivityRow[];
  const more = result.length > ACTIVITY_PAGE_SIZE;
  const rows = result.slice(0, ACTIVITY_PAGE_SIZE);
  if (filters.after) rows.reverse();
  const hasNewer = !!filters.before || (!!filters.after && more);
  const hasOlder = !!filters.after || (!filters.after && more);

  return <>
    <Link href="/perusahaan" className="back-btn">‹ Perusahaan</Link>
    <div className="crm-sec" style={{ marginTop: 12 }}>
      <SecHeader num="01" title="LOG AKTIVITAS" desc="Siapa, kapan, objek, dan perubahan — sesuai akses modul dan cabang." />
      <p style={{ fontSize: 12, color: 'var(--tm)' }}>Pencatatan dimulai setelah fitur diaktifkan. Tidak merekonstruksi riwayat lama. Mencakup sumber terdaftar pada persediaan/POS, CRM, penjualan, pembelian, keuangan, HRIS, klinik, perusahaan, pajak, dan pengaturan. Setiap catatan mengikuti akses sumber, modul, dan cabang. Audit koreksi terperinci tetap tersedia di transaksi asal.</p>
      <p style={{ fontSize: 12, color: 'var(--tm)' }}>Nilai data pribadi, catatan bebas, dan isi klinis disamarkan. Sebagian sumber hanya mencatat aktivitas tanpa rincian isi. Objek terhapus tetap dapat ditelusuri melalui identitas dan nomor dokumennya.</p>
      {filters.object && <p style={{ overflowWrap: 'anywhere' }}>Riwayat {ACTIVITY_ENTITIES[filters.entity]} · <code>{filters.object}</code> <Link href={activityHref(filters, { object: '', before: '', after: '' })}>Lepas objek</Link></p>}
      <form action={ACTIVITY_PATH} method="get" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end', marginBottom: 14 }}>
        {filters.object && <input type="hidden" name="object" value={filters.object} />}
        <label className="flab">Modul<select className="fi" aria-label="Modul" name="module" defaultValue={filters.module}><option value="">Semua modul</option>{Object.entries(ACTIVITY_MODULES).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
        <label className="flab">Objek<select className="fi" aria-label="Objek" name="entity" defaultValue={filters.entity}><option value="">Semua objek</option>{Object.entries(ACTIVITY_ENTITIES).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
        <label className="flab">Aksi<select className="fi" aria-label="Aksi" name="action" defaultValue={filters.action}><option value="">Semua aksi</option>{Object.entries(ACTIVITY_ACTIONS).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
        <label className="flab">Nomor / kode<input className="fi" aria-label="Nomor / kode" name="q" maxLength={120} defaultValue={filters.q} placeholder="Nomor dokumen atau kode" /></label>
        <label className="flab">Dari (WIB)<input className="fi" type="date" aria-label="Dari (WIB)" name="from" defaultValue={filters.from} /></label>
        <label className="flab">Sampai (WIB)<input className="fi" type="date" aria-label="Sampai (WIB)" name="to" defaultValue={filters.to} /></label>
        <button className="btn-def" type="submit">Terapkan</button><Link className="back-btn" href={ACTIVITY_PATH}>Reset</Link>
      </form>
      {error ? <div className="p2ban" role="alert">Riwayat belum dapat dimuat. Coba muat ulang atau hubungi admin untuk memeriksa kesiapan fitur.</div> : <>
        <div style={{ overflowX: 'auto' }}><table className="tbl" style={{ minWidth: 760 }}>
          <thead><tr><th>Waktu / pelaku</th><th>Modul / objek</th><th>Aksi</th><th>Perubahan</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td>{formatTime(row.occurred_at)}<br /><b>{row.actor_name}</b><br /><small>{row.actor_id ?? 'Otomatis / database'}</small></td>
            <td>{ACTIVITY_MODULES[row.module_id] ?? row.module_id}<br />{ACTIVITY_ENTITIES[row.entity] ?? row.entity}<br /><Link href={activityObjectHref(row.entity, row.entity_id)}>{row.object_label}</Link><br /><small style={{ overflowWrap: 'anywhere' }}>{row.entity_id}</small><br /><small>Sumber: {ACTIVITY_ENTITIES[row.row_entity] ?? row.row_entity}</small><br /><Link style={{ overflowWrap: 'anywhere', fontSize: 11 }} href={activityObjectHref(row.row_entity, row.row_id)}>{row.row_id}</Link></td>
            <td>{ACTIVITY_ACTIONS[row.action] ?? row.action}</td>
            <td>{row.changed_fields.length === 1 && row.changed_fields[0] === 'metadata' ? <span>Aktivitas tercatat; rincian isi disamarkan.</span> : <details><summary>{row.changed_fields.length} bagian berubah</summary><ul style={{ paddingLeft: 16 }}>{row.changed_fields.map(field => <li key={field}><code>{field}</code>: {Object.hasOwn(row.before_state, field) || Object.hasOwn(row.after_state, field) ? <>{value(row.before_state[field])} → {value(row.after_state[field])}</> : 'nilai disamarkan'}</li>)}</ul></details>}</td>
          </tr>)}{rows.length === 0 && <tr><td colSpan={4}>Belum ada aktivitas yang dapat ditampilkan untuk filter dan akses ini.</td></tr>}</tbody>
        </table></div>
        <nav aria-label="Halaman aktivitas" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          {rows.length > 0 && hasNewer && <Link href={activityHref(filters, { before: '', after: String(rows[0].id) })}>Lebih baru</Link>}
          {rows.length > 0 && hasOlder && <Link href={activityHref(filters, { before: String(rows[rows.length - 1].id), after: '' })}>Lebih lama</Link>}
          {(filters.before || filters.after) && <Link href={activityHref(filters, { before: '', after: '' })}>Kembali ke terbaru</Link>}
        </nav>
      </>}
    </div>
  </>;
}
