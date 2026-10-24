"use client";
import { createContext, useContext, type ReactNode } from "react";
import Link from 'next/link';
import { activityFilters, activityObjectHref } from '@/lib/activity-log';

export const ActivityNavigationContext = createContext(false);
export function ActivityNavigationProvider({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <ActivityNavigationContext.Provider value={allowed}>{children}</ActivityNavigationContext.Provider>;
}

/** Navigation follows existing page access; destination also enforces current RLS. */
export function ActivityHistoryLink({ entity, id }: { entity: string; id: string }) {
  const allowed = useContext(ActivityNavigationContext);
  const filters = activityFilters({ entity, object: id });
  if (!allowed || !filters.entity || !filters.object) return null;
  return <Link className="back-btn" href={activityObjectHref(entity, id)}><i className="ti ti-history" /> Riwayat aktivitas</Link>;
}
