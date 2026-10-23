import Link from 'next/link';
import { documentBackHref, relatedDocumentHref, relatedDocumentStatus, type DocumentKind } from '@/lib/related-document-routes';
export type RelatedDocument = { kind: DocumentKind; id: string; label: string; status: string; parentId?: string };
export function DocumentLink({ kind, id, parentId, from, children }: { kind: DocumentKind; id: string; parentId?: string; from?: string; children: React.ReactNode }) {
  const href = relatedDocumentHref(kind, id, parentId, from);
  return href ? <Link href={href}>{children}</Link> : <span>{children} (tautan belum tersedia)</span>;
}
export function DocumentBackLink({ from }: { from: unknown }) {
  const href = documentBackHref(from);
  return href ? <p className="no-print"><Link className="back-btn" href={href}>← Kembali ke transaksi asal</Link></p> : null;
}
export function RelatedDocuments({ documents, from, error, note }: { documents: RelatedDocument[]; from?: string; error?: boolean; note?: string }) {
  return <section className="crm-sec no-print" aria-label="Dokumen terkait">
    <h2 style={{ fontSize: 14, marginBottom: 8 }}>DOKUMEN TERKAIT</h2>
    {note && <p style={{ fontSize: 12, color: 'var(--tm)' }}>{note}</p>}
    {error && <p role="alert">Sebagian dokumen terkait belum dapat dimuat. Coba muat ulang.</p>}
    {!error && documents.length === 0 && <p>Belum ada dokumen terkait yang tersedia untuk akses Anda.</p>}
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))' }}>{documents.map(doc => <li key={`${doc.kind}:${doc.id}`} style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px', overflowWrap: 'anywhere' }}>
      <DocumentLink kind={doc.kind} id={doc.id} parentId={doc.parentId} from={from}>{doc.label}</DocumentLink><br />
      <small style={{ color: 'var(--tm)' }}>{relatedDocumentStatus(doc.status)}</small>
    </li>)}</ul>
  </section>;
}
