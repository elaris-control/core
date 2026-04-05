// nav_routes.js
'use strict';
const express=require('express');
function initNavRoutes({db,requireLogin,access}){
  db.exec("CREATE TABLE IF NOT EXISTS nav_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'page', sort_order INTEGER NOT NULL DEFAULT 0, instances_json TEXT NOT NULL DEFAULT '[]', page_type TEXT NOT NULL DEFAULT 'custom', pinned_home INTEGER NOT NULL DEFAULT 1, featured_home INTEGER NOT NULL DEFAULT 0, hero_order INTEGER NOT NULL DEFAULT 0, summary_config TEXT NOT NULL DEFAULT '{}', created_ts INTEGER NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_nav_pages_user ON nav_pages(user_id)");
  try {
    const cols = db.prepare("PRAGMA table_info(nav_pages)").all().map(r => r.name);
    if (!cols.includes('page_type')) db.exec("ALTER TABLE nav_pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'custom'");
    if (!cols.includes('pinned_home')) db.exec("ALTER TABLE nav_pages ADD COLUMN pinned_home INTEGER NOT NULL DEFAULT 1");
    if (!cols.includes('featured_home')) db.exec("ALTER TABLE nav_pages ADD COLUMN featured_home INTEGER NOT NULL DEFAULT 0");
    if (!cols.includes('hero_order')) db.exec("ALTER TABLE nav_pages ADD COLUMN hero_order INTEGER NOT NULL DEFAULT 0");
    if (!cols.includes('summary_config')) db.exec("ALTER TABLE nav_pages ADD COLUMN summary_config TEXT NOT NULL DEFAULT '{}'");
  } catch {}
  const L=db.prepare('SELECT * FROM nav_pages ORDER BY sort_order,id');
  const G=db.prepare('SELECT * FROM nav_pages WHERE id=? AND user_id=?');
  const I=db.prepare('INSERT INTO nav_pages(user_id,name,icon,sort_order,instances_json,page_type,pinned_home,featured_home,hero_order,summary_config,created_ts) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const U=db.prepare('UPDATE nav_pages SET name=?,icon=?,sort_order=?,instances_json=?,page_type=?,pinned_home=?,featured_home=?,hero_order=?,summary_config=? WHERE id=? AND user_id=?');
  const D=db.prepare('DELETE FROM nav_pages WHERE id=? AND user_id=?');
  const M=db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM nav_pages WHERE user_id=?");
  const validModuleIds=db.prepare("SELECT id, site_id FROM module_instances WHERE active=1");
  const r=express.Router();
  r.use(requireLogin);
  const uid=req=>req.user&&req.user.id;
  const sanitizeInstances=(req, raw)=>{ const allowed=new Set(validModuleIds.all().filter(r=>access.canAccessSite(req, r.site_id)).map(r=>Number(r.id))); return (Array.isArray(raw)?raw:[]).map(Number).filter(id=>allowed.has(id)); };
  const sanitizeSummaryConfig=(raw, allowedInstances)=>{
    const cfg=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
    const allowed=new Set((Array.isArray(allowedInstances)?allowedInstances:[]).map(Number));
    const normId=v=>{ const n=Number(v); return allowed.has(n)?n:null; };
    const pick=(v, ok, dflt)=> ok.includes(v) ? v : dflt;
    return {
      primary_instance_id: normId(cfg.primary_instance_id),
      secondary_instance_id: normId(cfg.secondary_instance_id),
      summary_mode: pick(cfg.summary_mode, ['auto','compact','detailed'], 'auto'),
      tone_source: pick(cfg.tone_source, ['auto','primary','secondary'], 'auto'),
      metrics_source: pick(cfg.metrics_source, ['auto','primary','secondary'], 'auto')
    };
  };
  const SYS=[{id:'dashboard',name:'Dashboard',icon:'home',system:true,sort_order:-100},{id:'scenes',name:'Scenes',icon:'scenes',system:true,sort_order:-90},{id:'help',name:'Help',icon:'help',system:true,sort_order:-80}];
  r.get('/pages',(req,res)=>{try{const c=L.all().map(p=>{const raw=JSON.parse(p.instances_json||'[]');const instances=sanitizeInstances(req, raw);const summaryConfig=sanitizeSummaryConfig(JSON.parse(p.summary_config||'{}'), instances);if(JSON.stringify(instances)!==JSON.stringify(raw) || JSON.stringify(summaryConfig)!==JSON.stringify(JSON.parse(p.summary_config||'{}'))) U.run(p.name,p.icon,p.sort_order,JSON.stringify(instances),p.page_type||'custom',Number(p.pinned_home!=null?p.pinned_home:1),Number(p.featured_home!=null?p.featured_home:0),Number(p.hero_order||0),JSON.stringify(summaryConfig),p.id,uid(req));return {...p,instances_json:JSON.stringify(instances),summary_config:JSON.stringify(summaryConfig),system:false,instances,summaryConfig};});res.json({ok:true,pages:[...SYS,...c].sort((a,b)=>a.sort_order-b.sort_order)});}catch(e){res.status(500).json({ok:false,error:e.message});}});
  r.post('/pages',(req,res)=>{try{const{name,icon,instances,page_type,pinned_home,featured_home,hero_order,summary_config}=req.body;if(!name)return res.status(400).json({ok:false,error:'missing_name'});const order=(M.get(uid(req)).m||0)+10;const safeInstances=sanitizeInstances(req, instances);const safeType=(typeof page_type==='string'&&page_type.trim())?page_type.trim():'custom';const safePinned=pinned_home===0||pinned_home===false?0:1;const safeFeatured=featured_home===1||featured_home===true?1:0;const safeHeroOrder=Number.isFinite(Number(hero_order))?Number(hero_order):0;const safeSummary=JSON.stringify(sanitizeSummaryConfig(summary_config, safeInstances));const x=I.run(uid(req),name,icon||'page',order,JSON.stringify(safeInstances),safeType,safePinned,safeFeatured,safeHeroOrder,safeSummary,Date.now());res.json({ok:true,id:x.lastInsertRowid});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  r.put('/pages/:id',(req,res)=>{try{const{name,icon,instances,sort_order,page_type,pinned_home,featured_home,hero_order,summary_config}=req.body;const p=G.get(Number(req.params.id),uid(req));if(!p)return res.status(404).json({ok:false,error:'not_found'});const safeInstances=instances!=null?sanitizeInstances(req, instances):sanitizeInstances(req, JSON.parse(p.instances_json));const safeType=(typeof page_type==='string'&&page_type.trim())?page_type.trim():String(p.page_type||'custom');const safePinned=(pinned_home!=null)?((pinned_home===0||pinned_home===false)?0:1):Number(p.pinned_home!=null?p.pinned_home:1);const safeFeatured=(featured_home!=null)?((featured_home===1||featured_home===true)?1:0):Number(p.featured_home!=null?p.featured_home:0);const safeHeroOrder=(hero_order!=null&&Number.isFinite(Number(hero_order)))?Number(hero_order):Number(p.hero_order||0);const currentSummary=JSON.parse(p.summary_config||'{}');const safeSummary=JSON.stringify(sanitizeSummaryConfig(summary_config!=null?summary_config:currentSummary, safeInstances));U.run(name!=null?name:p.name,icon!=null?icon:p.icon,sort_order!=null?sort_order:p.sort_order,JSON.stringify(safeInstances),safeType,safePinned,safeFeatured,safeHeroOrder,safeSummary,Number(req.params.id),uid(req));res.json({ok:true});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  r.delete('/pages/:id',(req,res)=>{try{D.run(Number(req.params.id),uid(req));res.json({ok:true});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  return r;
}
module.exports={initNavRoutes};
