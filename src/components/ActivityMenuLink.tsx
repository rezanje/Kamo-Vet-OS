"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useContext } from 'react';
import { ActivityHistoryLink, ActivityNavigationContext } from './ActivityHistoryLink';
import { activityMenuHref, activityRouteObject } from '@/lib/activity-log';

export function ActivityMenuLink() {
  const path = usePathname();
  const allowed = useContext(ActivityNavigationContext);
  const href = activityMenuHref(path);
  const object = activityRouteObject(path);
  if (!allowed || (!href && !object)) return null;
  return <div className="no-print" style={{ marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>{href && <Link href={href} className="back-btn"><i className="ti ti-history" /> Riwayat aktivitas menu</Link>}{object && <ActivityHistoryLink entity={object.entity} id={object.id} />}</div>;
}
