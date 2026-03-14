var COLORS=['#6366f1','#22d97a','#f59e0b','#1d8cff','#a855f7','#ef4444','#ec4899','#14b8a6','#f97316','#64748b'];
var _editId=null,_color=COLORS[0],_actions=[],_instances=[],_ios=[];
var _uiRole='USER';
var $=id=>document.getElementById(id);
function toast(msg,ms){var el=$('toast');if(!el)return;el.textContent=msg||'';setTimeout(function(){if(el.textContent===msg)el.textContent='';},ms||3000);}
async function api(path,opts){var res=await fetch('/api'+path,Object.assign({headers:{'Content-Type':'application/json'}},opts||{}));if(!res.ok){var j=null;try{j=await res.json();}catch(e){}throw new Error((j&&j.error)||'HTTP '+res.status);}return res.json();}
function applyTheme(t){document.documentElement.dataset.theme=t;}
function toggleTheme(){var c=document.documentElement.dataset.theme||'dark';var n=c==='dark'?'light':'dark';document.documentElement.dataset.theme=n;localStorage.setItem('elaris_theme',n);applyTheme(n);}
function canManageScenes(){ return _uiRole==='ENGINEER' || _uiRole==='ADMIN'; }
async function loadMe(){try{var me=window.ELARIS_ME||await api('/me');if(!me.ok||!me.user){window.location.href='/login.html';return;} _uiRole=(window.elarisComputeUiRole?window.elarisComputeUiRole(me):(window.ELARIS_UI_ROLE||me.role||'USER'));}catch(e){}}
async function loadNav(){try{var d=await fetch('/api/nav/pages').then(r=>r.json()).catch(()=>({pages:[]}));var custom=(d.pages||[]).filter(p=>!p.system);var c=$('navContainer');if(!c)return;c.innerHTML=custom.length?'<div class="groupTitle">My Pages</div><nav class="nav">'+custom.map(p=>'<a href="/page.html?id='+p.id+'">'+(p.icon||'📄')+' '+p.name+'</a>').join('')+'</nav>':'';}catch(e){}}
function buildColorPicker(sel){_color=sel||COLORS[0];var cp=$('colorPicker');if(!cp)return;cp.innerHTML=COLORS.map(col=>'<div class="color-swatch'+(col===_color?' sel':'')+'" style="background:'+col+'" onclick="selectColor(\''+col+'\')"></div>').join('')+'<input type="color" value="'+_color+'" id="customColor" style="width:24px;height:24px;border-radius:50%;border:2px solid var(--line);cursor:pointer;padding:0" oninput="selectColor(this.value)">';}
function selectColor(c){_color=c;document.querySelectorAll('#colorPicker .color-swatch').forEach(s=>s.classList.toggle('sel',s.style.background===c));var ci=$('customColor');if(ci)ci.value=c;}
async function loadMeta(){try{var sid=_activeSiteId();var d=await api('/modules/instances'+(sid?'?site_id='+sid:''));_instances=(d.instances||[]).filter(i=>i.active!==false);}catch(e){}try{var siteId=Number(localStorage.getItem('elaris_site_id')||0);if(!siteId){var sd=await api('/sites');siteId=(sd.sites||[])[0]?.id||0;}if(siteId){var id=await api('/modules/io/'+siteId);_ios=id.io||[];}}catch(e){}}
function _activeSiteId(){var s=localStorage.getItem('elaris_site_id');return s?Number(s):null;}
async function loadScenes(){
  var g=$('scenesGrid');if(!g)return;
  var sid=_activeSiteId();
  var d=await api('/scenes'+(sid?'?site_id='+sid:''));
  var scenes=d.scenes||[];
  var h='';
  var manage=canManageScenes();
  scenes.forEach(function(s){
    var col=s.color||'#6366f1';
    var sn=String(s.name||'').replace(/'/g,"\\'");
    var ac=0;try{ac=JSON.parse(s.actions_json||'[]').length;}catch(e){}
    h+='<div class="scene-card" id="sc-'+s.id+'" style="background:'+col+'22;border-color:'+col+'66">';
    if(manage) h+='<button class="scene-edit-btn" onclick="openEdit('+s.id+')">✎</button>';
    h+='<div class="scene-icon">'+(s.icon||'🎬')+'</div>';
    h+='<div class="scene-name">'+s.name+'</div>';
    if(ac>0 && manage) h+='<div style="font-size:10px;color:var(--muted2);margin-top:-4px">'+ac+' action'+(ac>1?'s':'')+'</div>';
    h+='<button id="abtn-'+s.id+'" class="scene-activate" style="background:'+col+'" onclick="activate('+s.id+',\''+sn+'\',\''+col+'\')">▶ Activate</button>';
    h+='</div>';
  });
  if(manage) h+='<div class="add-card" onclick="openNew()"><span style="font-size:28px">+</span><span>New Scene</span></div>';
  g.innerHTML=h;
}
async function activate(id,name,col){
  var btn=document.getElementById('abtn-'+id);
  var card=document.getElementById('sc-'+id);
  if(btn){btn.textContent='⏳ Running...';btn.style.background='#888';btn.disabled=true;}
  try{
    await fetch('/api/scenes/'+id+'/activate',{method:'POST',headers:{'Content-Type':'application/json'}});
    if(btn){btn.textContent='✅ Done!';btn.style.background='#22d97a';}
    if(card)card.style.boxShadow='0 0 0 3px #22d97a66';
    toast('✅ '+name+' activated');
    setTimeout(function(){if(btn){btn.textContent='▶ Activate';btn.style.background=col;btn.disabled=false;}if(card)card.style.boxShadow='';},2000);
  }catch(e){
    if(btn){btn.textContent='❌ Error';btn.style.background='#ef4444';btn.disabled=false;}
    toast('Error: '+e.message);
    setTimeout(function(){if(btn){btn.textContent='▶ Activate';btn.style.background=col;}},2500);
  }
}
function renderActions(){
  var c=$('actionsContainer');if(!c)return;
  if(!_actions.length){c.innerHTML='<div style="color:var(--muted2);font-size:12px;padding:10px 0">No actions yet. Add one below.</div>';return;}
  c.innerHTML=_actions.map(function(a,i){
    var label='';
    if(a.type==='set_setpoint'){
      var inst=_instances.find(function(x){return x.id===a.instance_id;});
      label='⚙️ <b>'+(inst?inst.name:'inst #'+a.instance_id)+'</b> → '+a.key+' = <b>'+a.value+'</b>';
    } else if(a.type==='send_command'){
      var io=_ios.find(function(x){return x.id===a.io_id;});
      label='📡 <b>'+(io?io.name:a.io_id)+'</b> → <b>'+a.value+'</b>';
    } else if(a.type==='notify'){
      label='🔔 Notify: <b>'+a.title+'</b>';
    } else if(a.type==='delay'){
      label='⏱️ Wait <b>'+a.seconds+'s</b>';
    }
    return '<div class="action-row"><span style="font-size:12px">'+label+'</span><button onclick="removeAction('+i+')" style="margin-left:auto;background:none;border:none;color:var(--bad);cursor:pointer;font-size:16px;padding:0 4px">✕</button></div>';
  }).join('');
}
function removeAction(i){_actions.splice(i,1);renderActions();}
function onActionTypeChange(){var t=$('aType').value;$('aSetpoint').style.display=t==='set_setpoint'?'':'none';$('aCommand').style.display=t==='send_command'?'':'none';$('aNotify').style.display=t==='notify'?'':'none';$('aDelay').style.display=t==='delay'?'':'none';}
function populateInstanceSelect(){var s=$('aInstance');if(!s)return;s.innerHTML=_instances.map(function(i){return'<option value="'+i.id+'">'+i.name+' ('+i.module_id+')</option>';}).join('');populateSettingKeys();}
function populateSettingKeys(){var s=$('aInstance');var ks=$('aSettingKey');if(!s||!ks)return;var inst=_instances.find(function(i){return i.id===Number(s.value);});var def=inst&&inst.definition;var keys=def&&def.setpoints?def.setpoints.map(function(sp){return sp.key;}):[];if(!keys.length)keys=['mode','setpoint','hysteresis','manual_override','manual_speed','profile','dt_on','dt_off','min_collector','max_boiler'];ks.innerHTML=keys.map(function(k){return'<option value="'+k+'">'+k+'</option>';}).join('');}
function populateIOSelect(){var s=$('aIO');if(!s)return;s.innerHTML=_ios.map(function(io){return'<option value="'+io.id+'">'+(io.name||io.key)+' ['+io.type+']</option>';}).join('');}
function addAction(){
  if(!canManageScenes()){toast('Engineer access required');return;}
  var t=$('aType').value;
  var a={type:t};
  if(t==='set_setpoint'){
    a.instance_id=Number($('aInstance').value);
    a.key=$('aSettingKey').value;
    a.value=($('aSettingVal').value||'').trim();
    if(!a.key){toast('Select a key');return;}
    if(a.value===''){toast('Enter a value (e.g. 22, basic)');return;}
  } else if(t==='send_command'){
    a.io_id=Number($('aIO').value);
    a.value=($('aIOVal').value||'').trim();
    if(!a.io_id){toast('Select an IO');return;}
    if(a.value===''){toast('Enter value (ON / OFF / 50)');return;}
  } else if(t==='notify'){
    a.title=($('aNotifyTitle').value||'').trim()||'Scene activated';
    a.body=($('aNotifyBody').value||'').trim();
    a.level=$('aNotifyLevel').value||'info';
  } else if(t==='delay'){
    a.seconds=Math.max(1,Math.min(300,Number($('aDelaySec').value)||2));
  }
  _actions.push(a);renderActions();
  var sv=$('aSettingVal');if(sv)sv.value='';
  var iv=$('aIOVal');if(iv)iv.value='';
  var nt=$('aNotifyTitle');if(nt)nt.value='';
  var nb=$('aNotifyBody');if(nb)nb.value='';
}
function openNew(){
  if(!canManageScenes()){toast('Engineer access required');return;}
  _editId=null;_actions=[];$('smTitle').textContent='New Scene';$('sm_icon').value='';$('sm_name').value='';$('smDeleteBtn').style.display='none';buildColorPicker(COLORS[0]);renderActions();populateInstanceSelect();populateIOSelect();onActionTypeChange();$('sceneModal').style.display='flex';loadSchedules(null);setTimeout(function(){$('sm_name').focus();},50);
}
function openEdit(id){
  if(!canManageScenes()){toast('Engineer access required');return;}
  _editId=id;
  var sid=_activeSiteId();
  api('/scenes'+(sid?'?site_id='+sid:'')).then(function(d){
    var s=(d.scenes||[]).find(function(x){return x.id===id;});
    if(!s)return;
    try{_actions=JSON.parse(s.actions_json||'[]');}catch(e){_actions=[];}
    $('smTitle').textContent='Edit Scene';$('sm_icon').value=s.icon||'';$('sm_name').value=s.name||'';$('smDeleteBtn').style.display='';buildColorPicker(s.color||COLORS[0]);renderActions();populateInstanceSelect();populateIOSelect();onActionTypeChange();$('sceneModal').style.display='flex';loadSchedules(id);setTimeout(function(){$('sm_name').focus();},50);
  });
}
function closeModal(){$('sceneModal').style.display='none';}
async function saveScene(){if(!canManageScenes()) return toast('Engineer access required');var n=$('sm_name').value.trim();if(!n){toast('Enter a name');return;}var ic=$('sm_icon').value.trim()||'🎬';var col=_color||COLORS[0];var sid=_activeSiteId();try{if(_editId)await api('/scenes/'+_editId,{method:'PUT',body:JSON.stringify({name:n,icon:ic,color:col,actions:_actions,site_id:sid})});else await api('/scenes',{method:'POST',body:JSON.stringify({name:n,icon:ic,color:col,actions:_actions,site_id:sid})});closeModal();await loadScenes();toast('Saved');}catch(e){toast('Error: '+e.message);}}
async function deleteScene(){if(!canManageScenes()) return toast('Engineer access required');if(!_editId||!confirm('Delete this scene?'))return;try{await api('/scenes/'+_editId,{method:'DELETE'});closeModal();await loadScenes();toast('Deleted');}catch(e){toast('Error: '+e.message);}}
async function loadSchedules(sceneId){
  if(!sceneId){$('scheduleList').innerHTML='';return;}
  try{
    var d=await api('/scenes/'+sceneId+'/schedules');
    var list=d.schedules||[];
    if(!list.length){$('scheduleList').innerHTML='<div style="color:var(--muted2);font-size:12px;padding:4px 0">No schedules.</div>';return;}
    $('scheduleList').innerHTML=list.map(function(s){
      var days=s.days||'1,2,3,4,5,6,7';
      var dayNames=['','Mo','Tu','We','Th','Fr','Sa','Su'];
      var dayStr=days.split(',').map(function(d){return dayNames[Number(d)]||d;}).join(' ');
      return '<div class="action-row"><span style="font-size:12px">🕐 <b>'+s.time+'</b> — '+dayStr+'</span>'+
        '<button onclick="deleteSchedule('+s.id+')" style="margin-left:auto;background:none;border:none;color:var(--bad);cursor:pointer;font-size:16px;padding:0 4px">✕</button></div>';
    }).join('');
  }catch(e){}
}
async function addSchedule(){
  if(!canManageScenes()||!_editId){toast('Save the scene first, then add schedules');return;}
  var time=$('schTime').value;
  if(!time){toast('Select a time');return;}
  var days=Array.from(document.querySelectorAll('#schDays input:checked')).map(function(c){return c.value;}).join(',');
  if(!days){toast('Select at least one day');return;}
  try{
    await api('/scenes/'+_editId+'/schedules',{method:'POST',body:JSON.stringify({time:time,days:days})});
    await loadSchedules(_editId);
    toast('Schedule added');
  }catch(e){toast('Error: '+e.message);}
}
async function deleteSchedule(id){
  try{
    await api('/scenes/schedules/'+id,{method:'DELETE'});
    await loadSchedules(_editId);
    toast('Removed');
  }catch(e){toast('Error: '+e.message);}
}
(async function(){
  applyTheme(localStorage.getItem('elaris_theme')||'dark');
  var mb=$('menuBtn');if(mb)mb.style.display='';
  await loadMe();
  await loadNav();
  await loadMeta();
  await loadScenes();
  if(!canManageScenes()){
    var del=$('smDeleteBtn'); if(del) del.style.display='none';
    var act=$('actionsEditor'); if(act) act.style.display='none';
    document.querySelectorAll('[onclick="saveScene()"]').forEach(function(btn){ btn.style.display='none'; });
  }
  $('sceneModal').addEventListener('click',function(e){if(e.target===$('sceneModal'))closeModal();});
})();
