#!/usr/bin/env node
// Local routing only. JWT verification remains in real GoTrue/PostgREST.
import http from 'node:http';
const server = http.createServer((req,res)=>{
  const auth = req.url.startsWith('/auth/v1/');
  const rest = req.url.startsWith('/rest/v1/');
  if (!auth&&!rest) {res.writeHead(404);return res.end();}
  const prefix = auth?'/auth/v1':'/rest/v1';
  const headers={...req.headers,host:auth?'127.0.0.1:55424':'127.0.0.1:55425'};
  const upstream=http.request({hostname:'127.0.0.1',port:auth?55424:55425,path:req.url.slice(prefix.length),method:req.method,headers},answer=>{
    res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(502);res.end('Local auth/API unavailable');});
  req.pipe(upstream);
});
server.listen(55421,'127.0.0.1',()=>console.log('Fictional LOCAL gateway http://127.0.0.1:55421'));
