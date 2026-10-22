// Static supporting inventory: literal Supabase chains/RPCs, not a proof that
// indirect/dynamic clients or database-side writes have all been discovered.
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
const root = process.cwd();
const sql = await fs.readFile('supabase/migrations/20261022070000_activity_audit.sql','utf8');
const registered = new Set([...sql.matchAll(/^ \('([a-z_]+)','(?:pos|crm|pembelian|penjualan|klinik|kas-bank|buku-besar|aset-tetap)'/gm)].map(m=>m[1]));
async function files(dir) {
 const entries = await fs.readdir(dir,{withFileTypes:true});
 const paths = await Promise.all(entries.filter(e=>!e.name.startsWith('__tests__')).map(e=>e.isDirectory()?files(path.join(dir,e.name)):/\.tsx?$/.test(e.name)&&!e.name.includes('.test.')?[path.join(dir,e.name)]:[]));
 return paths.flat();
}
function literal(node) {return node && (ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))?node.text:null;}
function table(node) {
 if (ts.isCallExpression(node)) {
  if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='from') return literal(node.arguments[0])??'[dynamic]';
  return table(node.expression);
 }
 return ts.isPropertyAccessExpression(node)?table(node.expression):null;
}
const calls=[];
for (const file of (await files('src')).sort()) {
 const source=ts.createSourceFile(file,await fs.readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(node) {
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)) {
   const method=node.expression.name.text;
   if(['insert','update','delete','upsert'].includes(method)) {
    const target=table(node.expression.expression);
    if(target)calls.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,method,target,registered:registered.has(target)});
   }else if(method==='rpc')calls.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,method,target:literal(node.arguments[0])??'[dynamic]',registered:null});
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
}
const output={baseline:'6289994422ce32e795f6f27baba04b5db477210d',scope:'Literal Supabase mutation chains and RPC calls in non-test src TS/TSX. A registered table captures actual row writes, not every semantic command or all related tables. RPC targets require inspection of their SQL implementations. Dynamic/indirect mutation clients are not comprehensively resolved.',registeredTables:[...registered].sort(),summary:{calls:calls.length,direct:calls.filter(c=>c.method!=='rpc').length,rpc:calls.filter(c=>c.method==='rpc').length,registeredDirect:calls.filter(c=>c.registered===true).length},calls};
const destination=process.argv[2]??'docs/evidence/2026-10-22-a01/mutation-inventory.json';
if(!path.resolve(destination).startsWith(root+path.sep))throw new Error('Output must be inside workspace');
await fs.mkdir(path.dirname(destination),{recursive:true});
await fs.writeFile(destination,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output.summary));
