"use client";
import {useState} from 'react';
import Link from 'next/link';
import {REPORT_GROUPS,type CatalogReport} from '@/lib/report-catalog';

export function ReportCatalog({entries}:{entries:CatalogReport[]}) {
  const [query,setQuery]=useState(''),[group,setGroup]=useState('');
  const words=query.trim().toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean);
  const visible=entries.filter(row=>(!group||row.groups.includes(group))&&words.every(word=>[row.label,...row.groups,...row.coverage,...row.notes,...row.gaps].join(' ').toLocaleLowerCase('id-ID').includes(word)));
  return <>
    <div className="pg-hd">DAFTAR LAPORAN</div>
    <p className="pg-sub">Cari nama atau kebutuhan laporan, lalu pilih kategori. Buka cakupan terkait untuk mengetahui letak rincian dan batas laporan.</p>
    <div className="crm-sec" style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end'}}>
      <div style={{flex:'1 1 220px'}}><label className="flab" htmlFor="report-query">Cari laporan</label><input id="report-query" aria-label="Cari laporan" className="fi" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Contoh: history bank, piutang, stok..."/></div>
      <div><label className="flab" htmlFor="report-category">Kategori</label><select id="report-category" aria-label="Kategori laporan" className="fi" value={group} onChange={e=>setGroup(e.target.value)}><option value="">Semua kategori</option>{REPORT_GROUPS.map(name=><option key={name}>{name}</option>)}</select></div>
      <button type="button" className="btn-def" onClick={()=>{setQuery('');setGroup('')}}>Bersihkan filter</button>
    </div>
    <p role="status" style={{fontSize:12}}>{visible.length} laporan cocok · {visible.filter(row=>row.status==='available').length} halaman tersedia pada akses ini</p>
    {REPORT_GROUPS.filter(name=>!group||name===group).map(name=>{const rows=visible.filter(row=>row.groups.includes(name));return !rows.length?null:<section key={name} aria-label={name} style={{marginBottom:20}}>
      <h2 style={{fontSize:16}}>{name}</h2><div className="tile-grid">{rows.map(row=>{
        const label=<><div className="ticon" style={{background:row.bg}}><i className={`ti ${row.icon}`} style={{color:row.fg}}/></div><div className="tlabel">{row.label}</div></>;
        return <article key={row.key} style={{minWidth:0}}>
          {row.href?<Link className="tile" href={row.href} prefetch={false}>{label}</Link>:<div className="tile" style={{opacity:.75,cursor:'default'}}>{label}</div>}
          <div style={{fontSize:11,margin:'6px 4px',overflowWrap:'anywhere'}}>{row.status==='available'?'Halaman tersedia':row.status==='restricted'?'Memerlukan akses modul terkait':'Belum tersedia'}</div>
          {!!row.coverage.length&&<details style={{fontSize:11,margin:'6px 4px'}}><summary>Cakupan / kebutuhan terkait</summary><ul>{row.coverage.map(item=><li key={item}>{item}</li>)}</ul>{row.notes.map(note=><p key={note}>{note}</p>)}</details>}
          {row.gaps.map(gap=><p key={gap} style={{fontSize:11,color:'#92400e',margin:'6px 4px'}}>{gap}</p>)}
        </article>;
      })}</div>
    </section>})}
    {!visible.length&&<p>Tidak ada laporan yang cocok. Ubah kata pencarian atau kategori.</p>}
  </>;
}
