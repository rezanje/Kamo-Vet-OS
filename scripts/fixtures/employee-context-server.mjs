import http from 'node:http';
import crypto from 'node:crypto';
const uid='eb100000-0000-4000-8000-000000000002';
const branches=[{id:'eb200000-0000-4000-8000-000000000001',code:'A',name:'Fictional Cabang A',type:'BOTH',is_active:true},{id:'eb200000-0000-4000-8000-000000000002',code:'B',name:'Fictional Cabang B',type:'BOTH',is_active:true}];
let fixture={role:'STAFF',active:true,grants:branches.map(b=>b.id),shift:null,rules:[],branchFailure:false};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const header=encode({alg:'HS256',typ:'JWT'}),claims=encode({sub:uid,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),iss:'http://127.0.0.1:54390/auth/v1'});
const token=header+'.'+claims+'.'+crypto.createHmac('sha256','fictional-secret').update(header+'.'+claims).digest('base64url');
const user={id:uid,email:'fictional@test.local',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let data=[];let status=200;
 if(url.pathname==='/fixture'){
  if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;fixture={...fixture,...JSON.parse(body)};}
  data={...fixture,uid,branches,token};
 }else if(url.pathname.endsWith('/token'))data={access_token:token,refresh_token:'fictional-refresh',expires_in:3600,token_type:'bearer',user};
 else if(url.pathname.endsWith('/user'))data=user;
 else if(url.pathname.endsWith('/logout'))data={};
 else if(url.pathname.endsWith('/jwks.json'))data={keys:[]};
 else if(url.pathname.startsWith('/rest/v1/')){
  const table=url.pathname.split('/').at(-1);
  if(table==='profiles')data=[{id:uid,full_name:'Fictional Employee',role:fixture.role,is_active:fixture.active}];
  else if(table==='role_modules')data=fixture.rules;
  else if(table==='user_branches')data=fixture.grants.map(branch_id=>({user_id:uid,branch_id}));
  else if(table==='branches'){
   if(fixture.branchFailure){status=500;data={message:'Fictional read failure',code:'TEST_FAILURE'};}
   else{data=branches.filter(b=>{
    const filter=url.searchParams.get('id');const selected=req.headers['x-kamo-operational-branch'];
    return (!filter||filter==='eq.'+b.id||filter.startsWith('in.')&&filter.includes(b.id))&&(!selected||selected===b.id);
   });}
  }else if(table==='cashier_shifts'){
   const selected=req.headers['x-kamo-operational-branch'];const type=url.searchParams.get('shift_type');
   data=fixture.shift&&(!selected||selected===fixture.shift.branch_id)&&(!type||type==='eq.'+fixture.shift.shift_type)?[fixture.shift]:[];
  }else if(table==='employees')data=[{id:'eb500000-0000-4000-8000-000000000001',nik:'FICT-001',nama:'Fictional Employee',jabatan:'Kasir',branch_id:branches[0].id,profile_id:uid,status:'Aktif'}];
  if(req.method!=='GET'&&req.method!=='HEAD'){status=400;data={message:'Business mutations disabled in browser fixture'};}
 }
 res.writeHead(status,{'content-type':'application/json','content-range':`0-${Math.max(0,data.length-1)}/${Array.isArray(data)?data.length:1}`});res.end(JSON.stringify(data));
}).listen(54390,'127.0.0.1',()=>console.log('Fictional auth/data fixture listening on localhost:54390'));
