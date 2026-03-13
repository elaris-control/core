// nav_routes.js
'use strict';
const express=require('express');
function initNavRoutes({db,requireLogin}){
  db.exec("CREATE TABLE IF NOT EXISTS nav_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'page', sort_order INTEGER NOT NULL DEFAULT 0, instances_json TEXT NOT NULL DEFAULT '[]', created_ts INTEGER NOT NULL)");
  const L=db.prepare('SELECT * FROM nav_pages WHERE user_id=? ORDER BY sort_order,id');
  const G=db.prepare('SELECT * FROM nav_pages WHERE id=? AND user_id=?');
  const I=db.prepare('INSERT INTO nav_pages(user_id,name,icon,sort_order,instances_json,created_ts) VALUES(?,?,?,?,?,?)');
  const U=db.prepare('UPDATE nav_pages SET name=?,icon=?,sort_order=?,instances_json=? WHERE id=? AND user_id=?');
  const D=db.prepare('DELETE FROM nav_pages WHERE id=? AND user_id=?');
  const M=db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM nav_pages WHERE user_id=?");
  const validModuleIds=db.prepare("SELECT id FROM module_instances WHERE active=1");
  const r=express.Router();
  r.use(requireLogin);
  const uid=req=>req.user&&req.user.id;
  const SYS=[{id:'dashboard',name:'Dashboard',icon:'home',system:true,sort_order:-100},{id:'scenes',name:'Scenes',icon:'scenes',system:true,sort_order:-90},{id:'help',name:'Help',icon:'help',system:true,sort_order:-80}];
  r.get('/pages',(req,res)=>{try{const valid=new Set(validModuleIds.all().map(r=>Number(r.id)));const c=L.all(uid(req)).map(p=>{const raw=JSON.parse(p.instances_json||'[]');const instances=(Array.isArray(raw)?raw:[]).map(Number).filter(id=>valid.has(id));if(JSON.stringify(instances)!==JSON.stringify(raw)) U.run(p.name,p.icon,p.sort_order,JSON.stringify(instances),p.id,uid(req));return {...p,instances_json:JSON.stringify(instances),system:false,instances};});res.json({ok:true,pages:[...SYS,...c].sort((a,b)=>a.sort_order-b.sort_order)});}catch(e){res.status(500).json({ok:false,error:e.message});}});
  r.post('/pages',(req,res)=>{try{const{name,icon,instances}=req.body;if(!name)return res.status(400).json({ok:false,error:'missing_name'});const order=(M.get(uid(req)).m||0)+10;const x=I.run(uid(req),name,icon||'page',order,JSON.stringify(instances||[]),Date.now());res.json({ok:true,id:x.lastInsertRowid});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  r.put('/pages/:id',(req,res)=>{try{const{name,icon,instances,sort_order}=req.body;const p=G.get(Number(req.params.id),uid(req));if(!p)return res.status(404).json({ok:false,error:'not_found'});U.run(name!=null?name:p.name,icon!=null?icon:p.icon,sort_order!=null?sort_order:p.sort_order,JSON.stringify(instances!=null?instances:JSON.parse(p.instances_json)),Number(req.params.id),uid(req));res.json({ok:true});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  r.delete('/pages/:id',(req,res)=>{try{D.run(Number(req.params.id),uid(req));res.json({ok:true});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  return r;
}
module.exports={initNavRoutes};
