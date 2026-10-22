"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useContext } from 'react';
import { ActivityNavigationContext } from './ActivityHistoryLink';
import { activityMenuHref } from '@/lib/activity-log';

export function ActivityMenuLink() {
  const path = usePathname();
  const allowed = useContext(ActivityNavigationContext);
  const href = activityMenuHref(path);
  if (!allowed || !href) return null;
  return <div style={{ marginBottom: 12 }}><Link href={href} className="back-btn"><i className="ti ti-history" /> Riwayat aktivitas menu</Link></div>;
}
