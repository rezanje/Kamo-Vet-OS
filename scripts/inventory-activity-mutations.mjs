// Static supporting evidence. Applied-database trigger checks and native SQL
// lifecycle tests establish runtime capture; this script never claims to do so.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
const root = process.cwd();
const args = process.argv.slice(2);
const schemaIndex = args.indexOf('--schema');
const schemaPath = schemaIndex < 0 ? 'docs/evidence/2026-10-22-a01/schema-snapshot.json' : args.splice(schemaIndex,2)[1];
if (!schemaPath || args.length > 1) throw new Error('Usage: node scripts/inventory-activity-mutations.mjs [output.json] [--schema schema.json]');
const destination = args[0] ?? 'docs/evidence/2026-10-22-a01/mutation-inventory.json';
const schemaBytes = await fs.readFile(schemaPath);
const schema = JSON.parse(schemaBytes);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

// Literal-only SQL parser: commas inside arrays/JSON strings stay intact;
// unrecognized SQL fails instead of silently dropping a registered source.
function splitSql(input, delimiter=',') {
 const parts=[]; let start=0; let depth=0; let quoted=false;
 for(let i=0;i<input.length;i++) {
  if(input[i]==="'") {if(quoted&&input[i+1]==="'"){i++;continue;}quoted=!quoted;continue;}
  if(quoted)continue;
  if('(['.includes(input[i]))depth++;
  if(')]'.includes(input[i]))depth--;
  if(input[i]===delimiter&&depth===0){parts.push(input.slice(start,i).trim());start=i+1;}
 }
 if(quoted||depth!==0)throw new Error('Unbalanced registry SQL expression');
 parts.push(input.slice(start).trim());return parts;
}
function sqlString(expression) {
 const match=expression.trim().match(/^'((?:[^']|'')*)'(?:::[a-z_\[\]]+)?$/i);
 if(!match)throw new Error('Expected registry SQL literal: '+expression);
 return match[1].replaceAll("''", "'");
}
const arrayColumns=new Set(['value_keys','identity_keys','branch_columns','reader_roles']);
function configValue(column,expression) {
 if(/^null$/i.test(expression))return null;
 if(/^(true|false)$/i.test(expression))return expression.toLowerCase()==='true';
 if(arrayColumns.has(column)) {
  const array=expression.match(/^array\[([\s\S]*)\](?:::[a-z_\[\]]+)?$/i);
  if(array)return array[1].trim()?splitSql(array[1]).map(sqlString):[];
  if(sqlString(expression)==='{}')return [];
  throw new Error('Unsupported registry array: '+expression);
 }
 const literal=sqlString(expression);
 return ['scope_parents','module_map'].includes(column)?JSON.parse(literal):literal;
}
function uncomment(sql) {
 let quoted=false;let output='';
 for(let i=0;i<sql.length;i++) {
  if(sql[i]==="'"){output+=sql[i];if(quoted&&sql[i+1]==="'"){output+=sql[++i];continue;}quoted=!quoted;continue;}
  if(!quoted&&sql[i]==='-'&&sql[i+1]==='-'){
   while(i<sql.length&&sql[i]!=='\n'){output+=' ';i++;}if(i<sql.length)output+='\n';
  }else output+=sql[i];
 }
 return output;
}
function statementEnd(sql,start) {
 let quoted=false;
 for(let i=start;i<sql.length;i++){
  if(sql[i]==="'"){if(quoted&&sql[i+1]==="'"){i++;continue;}quoted=!quoted;}
  if(!quoted&&sql[i]===';')return i;
 }throw new Error('Unterminated registry statement');
}
const registry=new Map();const registryMigrations=[];
const migrationNames=(await fs.readdir('supabase/migrations')).filter(name=>/^20261022(?:070000|08[0-4]000)_activity_audit.*\.sql$/.test(name)).sort();
if(migrationNames.length!==6)throw new Error('Expected all six A01 migrations:070000 and080000–084000');
for(const name of migrationNames){
 const file=path.join('supabase/migrations',name);const original=await fs.readFile(file,'utf8');const sql=uncomment(original);
 const provenance=index=>({file,line:original.slice(0,index).split('\n').length});let inserted=0;let updated=0;
 for(const match of sql.matchAll(/\binsert\s+into\s+public\.activity_log_sources\s*\(([^)]*)\)\s*values\b/gi)){
  const columns=match[1].split(',').map(value=>value.trim());const start=match.index+match[0].length;
  for(const tuple of splitSql(sql.slice(start,statementEnd(sql,start)))){
   if(!tuple.startsWith('(')||!tuple.endsWith(')'))throw new Error('Unsupported registry tuple in '+file);
   const expressions=splitSql(tuple.slice(1,-1));if(expressions.length!==columns.length)throw new Error('Registry columns/values mismatch in '+file);
   const config={label_key:null,value_keys:[],parent_entity:null,parent_key:null,identity_keys:['id'],branch_columns:[],scope_parents:[],metadata_only:false,reader_roles:['OWNER','ADMIN'],owner_column:null,module_column:null,module_map:{}};
   columns.forEach((column,index)=>{config[column]=configValue(column,expressions[index]);});
   if(registry.has(config.entity))throw new Error('Duplicate source: '+config.entity);
   registry.set(config.entity,{...config,registration:provenance(match.index),overrides:[]});inserted++;
  }
 }
 for(const match of sql.matchAll(/\bupdate\s+public\.activity_log_sources\s+set\s+/gi)){
  const start=match.index+match[0].length;const statement=sql.slice(start,statementEnd(sql,start));
  const where=statement.match(/\s+where\s+entity\s*(=\s*'[^']+'|in\s*\([^)]*\))\s*$/i);
  if(!where)throw new Error('Unsupported source UPDATE predicate in '+file);
  for(const entity of [...where[1].matchAll(/'([^']+)'/g)].map(value=>value[1])){
   const config=registry.get(entity);if(!config)throw new Error('UPDATE of missing source: '+entity);
   for(const assignment of splitSql(statement.slice(0,where.index))){
    const field=assignment.match(/^([a-z_]+)\s*=\s*([\s\S]+)$/i);if(!field)throw new Error('Unsupported source assignment: '+assignment);
    config[field[1]]=configValue(field[1],field[2]);
   }config.overrides.push(provenance(match.index));updated++;
  }
 }
 registryMigrations.push({file,sha256:digest(original),registeredSources:inserted,sourceOverrides:updated});
}

// Exclusions are table-by-table decisions, not guessed from suffixes. Every
// excluded table's own row writes remain outside the common activity index.
const exclusionGroups={
 audit_infrastructure:{reason:'The common index/private source registry itself; recursive source capture is excluded.',tables:['activity_log','activity_log_sources']},
 request_receipt:{reason:'Durable command idempotency/recovery receipt, payload/hash and result. The receipt row itself is not indexed and does not capture its business-source changes.',tables:[
  'bank_reconciliation_requests','cash_entry_revision_requests','cash_transfer_requests','clinic_invoice_operations','expense_posting_requests','fixed_asset_value_requests','journal_revision_requests','manual_journal_create_requests','monetary_opening_requests','opening_balance_create_requests','purchase_invoice_cancellation_requests','purchase_operations','purchase_order_requests','purchase_payment_cancellation_requests','purchase_payment_order_requests','purchase_payment_requests','return_record_requests','sale_cancellation_requests','sales_posting_requests','staff_reward_requests','stock_document_correction_requests','unit_posting_requests','wholesale_operation_requests']},
 domain_history:{reason:'Existing domain correction, revision or audit history remains authoritative; its own snapshot/history row mutation is not duplicated in the common index.',tables:[
  'bank_reconciliation_revisions','cash_entry_revisions','cash_transfer_revisions','expense_revisions','fixed_asset_corrections','inpatient_daily_log_edits','inpatient_status_log','invoice_edit_log','journal_revisions','master_data_lifecycle_audit','monetary_opening_corrections','purchase_order_revisions','purchase_payment_cancellations','return_record_corrections','sale_cancellations','simulation_reset_audits','stock_document_corrections','wholesale_invoice_corrections']},
 posting_proof:{reason:'Internal expected-journal/FIFO/original-posting snapshot or finalization links used as correction/guard evidence. Proof row/link mutations themselves are not indexed.',tables:['pos_sale_postings','purchase_invoice_postings','return_record_postings']},
 technical_concurrency:{reason:'Internal epoch counters invalidate stale wholesale-payroll snapshots; counter row mutations are not business activity events.',tables:['wholesale_payroll_epochs']},
};
const exclusions=new Map(Object.entries(exclusionGroups).flatMap(([classification,{tables,reason}])=>tables.map(entity=>[entity,{classification,reason}])));
const sources=[...registry.values()].sort((a,b)=>a.entity.localeCompare(b.entity));
for(const config of sources){
 const tableSchema=schema[config.entity];if(!tableSchema)throw new Error('Registered source missing from schema: '+config.entity);
 const columns=new Set(tableSchema.columns.map(column=>column.name));
 const pk=tableSchema.constraints.find(constraint=>constraint.startsWith('PRIMARY KEY ('))?.match(/^PRIMARY KEY \(([^)]+)\)/)?.[1].split(',').map(value=>value.trim());
 if(!pk||JSON.stringify(pk)!==JSON.stringify(config.identity_keys))throw new Error('Identity differs from actual PK: '+config.entity);
 for(const column of [...config.identity_keys,...config.value_keys,...config.branch_columns,config.label_key,config.owner_column,config.module_column,config.parent_key,...config.scope_parents.map(ref=>ref.key)].filter(Boolean))if(!columns.has(column))throw new Error('Missing source column: '+config.entity+'.'+column);
 for(const parent of [config.parent_entity,...config.scope_parents.map(ref=>ref.entity)].filter(Boolean))if(!registry.has(parent))throw new Error('Unregistered parent: '+config.entity+' -> '+parent);
 config.primaryKey=pk;config.possibleModules=config.module_column?[...new Set(Object.values(config.module_map))].sort():[config.module_id];
}
const unregistered=Object.keys(schema).filter(entity=>!registry.has(entity)).sort();
for(const entity of unregistered)if(!exclusions.has(entity))throw new Error('Unclassified schema table: '+entity);
for(const entity of exclusions.keys())if(!unregistered.includes(entity))throw new Error('Stale table exclusion: '+entity);

async function files(dir){
 const entries=await fs.readdir(dir,{withFileTypes:true});
 return(await Promise.all(entries.filter(entry=>!entry.name.startsWith('__tests__')).map(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):/\.tsx?$/.test(entry.name)&&!entry.name.includes('.test.')?[path.join(dir,entry.name)]:[]))).flat();
}
function literal(node){return node&&(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))?node.text:null;}
function table(node){
 if(ts.isCallExpression(node)){if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='from')return literal(node.arguments[0])??'[dynamic]';return table(node.expression);}
 return ts.isPropertyAccessExpression(node)?table(node.expression):null;
}
const calls=[];
for(const file of(await files('src')).sort()){
 const source=ts.createSourceFile(file,await fs.readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
   const method=node.expression.name.text;
   if(['insert','update','delete','upsert'].includes(method)){
    const target=table(node.expression.expression);
    if(target)calls.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,method,target,registered:registry.has(target),classification:registry.has(target)?'registered_source':exclusions.get(target)?.classification??(target==='[dynamic]'?'dynamic_target':'unclassified_target'),modules:registry.get(target)?.possibleModules??[]});
   }else if(method==='rpc')calls.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,method,target:literal(node.arguments[0])??'[dynamic]',registered:null,classification:'rpc_requires_sql_lifecycle_inspection'});
  }ts.forEachChild(node,visit);
 }visit(source);
}
const dynamicReview={file:'src/app/(app)/hris/pengajuan/actions.ts',helper:'putuskan',targets:['overtime_requests','reimbursements','cash_advances'],evidence:'All five current literal callers of putuskan supply these registered tables; this is a manual review, not general dynamic resolution.'};
for(const target of dynamicReview.targets)if(!registry.has(target))throw new Error('Reviewed dynamic caller lost capture: '+target);
const unclassified=calls.filter(call=>call.classification==='unclassified_target');
if(unclassified.length)throw new Error('Unclassified literal direct writes: '+JSON.stringify(unclassified));
const direct=calls.filter(call=>call.method!=='rpc');
const coverageByModule=[...new Set(sources.flatMap(source=>source.possibleModules))].sort().map(module=>({module,sources:sources.filter(source=>source.possibleModules.includes(module)).map(source=>source.entity),directCallSites:direct.filter(call=>call.modules.includes(module)).length,sharedSources:sources.filter(source=>source.module_column&&source.possibleModules.includes(module)).map(source=>source.entity)}));
const allMigrations=await Promise.all((await fs.readdir('supabase/migrations')).sort().map(async file=>({file:path.join('supabase/migrations',file),sql:await fs.readFile(path.join('supabase/migrations',file),'utf8')})));
const excludedTables=unregistered.map(entity=>{
 const definition=allMigrations.find(migration=>new RegExp('create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?'+entity+'\\s*\\(','i').test(migration.sql));
 return{entity,...exclusions.get(entity),ownRowMutationsIndexed:false,primaryKey:schema[entity].constraints.find(constraint=>constraint.startsWith('PRIMARY KEY (')),definition:definition?.file??null,directCallSites:direct.filter(call=>call.target===entity).map(({file,line,method})=>({file,line,method}))};
});
const summary={schemaTables:Object.keys(schema).length,registeredTables:registry.size,excludedTables:excludedTables.length,calls:calls.length,direct:direct.length,rpc:calls.filter(call=>call.method==='rpc').length,registeredDirect:direct.filter(call=>call.registered).length,classifiedExcludedDirect:direct.filter(call=>!call.registered&&call.target!=='[dynamic]').length,dynamicDirect:direct.filter(call=>call.target==='[dynamic]').length,unclassifiedLiteralDirect:unclassified.length,exclusionCategories:Object.fromEntries(Object.keys(exclusionGroups).map(category=>[category,excludedTables.filter(table=>table.classification===category).length]))};
const limitations=[
 'Registered tables / supplied public-schema tables is a storage coverage count, not a percentage of user actions, RPCs, rows or historical records.',
 'Only future successful INSERT/UPDATE/DELETE row changes on registered sources are indexed. Unchanged retries produce no event; source TRUNCATE and historical backfill are not captured.',
 `${excludedTables.length} explicitly classified tables have no common-index event for their own row mutations. Request receipts do not capture source changes; registered source triggers do that separately. Existing domain histories and posting proofs remain outside this common index.`,
 'Literal Supabase chains and RPC sites are scanned in non-test src TS/TSX. Generic helpers, aliases, computed targets, JavaScript outside src and database-side/dynamic writes are not comprehensively resolved.',
 'RPCs are listed, not declared covered or expanded into a transitive SQL write graph. Applied-database trigger checks and native lifecycle/retry/rollback SQL tests supply separate runtime evidence.',
 'Visibility is narrower than storage coverage where metadata-only/private sources, roles/ownership, modules, branch intersections or operational selection require it.',
 'cashier_shifts routes by shift_type to pos or klinik; per-module counts overlap for this shared source and are not additive.',
];
const output={baseline:'102f3b0555305524611296e29d16affc12553eb7',scope:'Explicit A01 registry coverage reconciled with supplied actual schema metadata, plus supporting literal non-test src Supabase mutation/RPC inventory.',schemaSnapshot:{path:schemaPath,sha256:digest(schemaBytes),tables:Object.keys(schema).length},registryMigrations,summary,registeredTables:sources.map(source=>source.entity),sources,coverageByModule,excludedTables,manuallyReviewedDynamicWrites:[dynamicReview],limitations,calls};
if(!path.resolve(destination).startsWith(root+path.sep))throw new Error('Output must be inside workspace');
await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,JSON.stringify(output,null,2)+'\n');
const markdown=['# A01 source coverage inventory','',`Generated by \`node scripts/inventory-activity-mutations.mjs --schema ${schemaPath}\`. Schema SHA-256: \`${output.schemaSnapshot.sha256}\`.`,'',`${summary.registeredTables} registered sources / ${summary.schemaTables} public-schema tables; ${summary.excludedTables} explicitly classified tables remain outside the common index.`,'',`${summary.calls} literal call sites: ${summary.registeredDirect}/${summary.direct} direct mutation chains target registered sources, ${summary.classifiedExcludedDirect} target excluded tables, and ${summary.dynamicDirect} have dynamic targets. ${summary.rpc} RPC sites are listed separately. These counts do not measure business-action coverage.`,'','| Module | Registered sources | Literal direct-write sites |','| --- | ---: | ---: |',...coverageByModule.map(module=>`| ${module.module} | ${module.sources.length} | ${module.directCallSites} |`),'','Manual review of the one dynamic direct-write helper (`hris/pengajuan/actions.ts` → `putuskan`) resolves its current callers to registered `overtime_requests`, `reimbursements`, and `cash_advances`. Static counts remain unchanged; future dynamic callers need review.','','Shared cashier shifts count in both `pos` and `klinik`; totals overlap.','','## Coverage boundaries','',...limitations.map(value=>'- '+value),'','## Explicit excluded tables','','| Table | Classification | Reason |','| --- | --- | --- |',...excludedTables.map(table=>`| ${table.entity} | ${table.classification} | ${table.reason} |`),'','Each excluded table has `ownRowMutationsIndexed: false`. The JSON lists every discovered direct-write site for those excluded rows; existing request/domain stores do not establish coverage of their source mutations.','','## Registered sources by module','',...coverageByModule.flatMap(module=>['### '+module.module,'',module.sources.map(source=>'`'+source+'`').join(', ')+'.',''])];
await fs.writeFile(path.join(path.dirname(destination),'source-coverage.md'),markdown.join('\n').trimEnd()+'\n');
console.log(JSON.stringify(summary));
