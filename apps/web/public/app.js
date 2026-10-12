'use strict';
const $ = id => document.getElementById(id);
const paths = { plus:'M12 5v14M5 12h14',close:'m6 6 12 12M18 6 6 18',check:'m5 12 4 4L19 6',arrow:'M12 19V5m-6 6 6-6 6 6',play:'m8 5 11 7-11 7V5Z',stop:'M6 6h12v12H6Z',chevron:'m7 10 5 5 5-5',refresh:'M20 8a8 8 0 0 0-14-2L3 9m0-6v6h6m-5 7a8 8 0 0 0 14 2l3-3m0 6v-6h-6',monitor:'M3 4h18v13H3ZM8 21h8m-4-4v4',bell:'M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9m4 12h4',settings:'M4 7h16M4 17h16M9 4v6m6 4v6',hand:'M7 11V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 8-7 8-3 0-5-2-7-5l-2-3a2 2 0 0 1 3-2l2 2'};
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('icon');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.plus);svg.append(p);return svg;}
document.querySelectorAll('[data-icon]').forEach(node=>node.replaceChildren(icon(node.dataset.icon)));
function el(tag, cls, value){const node=document.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=value;return node;}
function button(name,label,cls='icon-button'){const b=el('button',cls);b.type='button';b.title=label;b.setAttribute('aria-label',label);b.append(icon(name));return b;}
let state, runId=null, runData=null, view='tasks', projectHash='', paired=false, refreshing=false, toastTimer, installPrompt;
const expanded=new Set(), drafts=new Map(), colors=['#db5a45','#258d91','#b47b15','#3d74ce','#805ec3'];
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
async function api(route,body,method=body===undefined?'GET':'POST'){
  const response=await fetch('/api/mobile/'+route,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Dooo-Request':'1'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok){if(response.status===401){paired=false;$('workspace').hidden=true;$('pair-view').hidden=false;}throw new Error(data.error||'Connection interrupted. Please retry.');}return data;
}
function showView(next){view=next;$('tasks-view').hidden=next!=='tasks';$('pc-view').hidden=next!=='pc';$('settings-view').hidden=next!=='settings';for(const [id,name]of [['tasks-tab','tasks'],['pc-tab','pc']]){$(id).classList.toggle('selected',next===name);$(id).setAttribute('aria-pressed',String(next===name));}if(next==='pc')void refreshRun();}
function pc(){return state?.devices.find(d=>d.online&&!d.locked)||state?.devices[0];}
function busy(){return state?.runs.some(r=>['queued','running','waiting_approval'].includes(r.status));}
function canRun(){const device=pc();return !!device?.online&&device.enabled&&!device.locked&&!busy();}
function renderProjects(){
  const hash=JSON.stringify([state.projects.map(p=>[p.id,p.name]),state.tasks]);if(hash===projectHash)return;projectHash=hash;
  const focused=document.activeElement, focusId=focused?.id, selection=focused?.selectionStart;
  const list=$('projects');list.replaceChildren();
  if(!state.projects.length){list.append(el('p','empty','Create your first project with +.'));return;}
  state.projects.forEach((project,index)=>{
    const tasks=state.tasks.filter(t=>t.projectId===project.id), done=tasks.filter(t=>t.done).length, progress=tasks.length?Math.round(done/tasks.length*100):0;
    const card=el('article','project-card'),head=el('button','project-head');head.type='button';head.setAttribute('aria-expanded',String(expanded.has(project.id)));head.setAttribute('aria-controls','project-'+project.id);
    const copy=el('div');copy.append(el('h2','',project.name));const sub=el('div','project-sub',tasks.length?`${done} of ${tasks.length} completed`:'No tasks yet');sub.append(icon('chevron'));copy.append(sub);
    const ring=el('div','ring');ring.style.setProperty('--ring',colors[index%colors.length]);ring.setAttribute('aria-hidden','true');ring.innerHTML='<svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="23"/><circle class="arc" cx="28" cy="28" r="23"/></svg>';ring.querySelector('.arc').setAttribute('stroke-dasharray',`${progress*1.445} 144.5`);ring.querySelector('.arc').style.visibility=progress?'visible':'hidden';ring.append(el('b','',progress+'%'));head.append(copy,ring);
    const body=el('div','project-body');body.id='project-'+project.id;body.hidden=!expanded.has(project.id);head.onclick=()=>{if(expanded.has(project.id))expanded.delete(project.id);else expanded.add(project.id);body.hidden=!expanded.has(project.id);head.setAttribute('aria-expanded',String(!body.hidden));};
    const items=el('ul','task-list');tasks.sort((a,b)=>Number(a.done)-Number(b.done)||(a.done?(a.completedAt||0)-(b.completedAt||0):b.createdAt-a.createdAt));
    for(const task of tasks){const row=el('li','task'+(task.done?' done':'')),title=el('span','task-title',task.title);row.append(title);
      if(!task.done){const run=button('play','Run this task on your PC','icon-button run-task');run.onclick=()=>start(task.title,task.id);row.append(run);}
      const check=button('check',task.done?'Reopen task':'Mark task done','task-check');if(!task.done)check.replaceChildren();check.onclick=async()=>{check.disabled=true;try{await api('task',{id:task.id,done:!task.done});await refresh();}catch(e){toast(e.message);check.disabled=false;}};row.append(check);items.append(row);}
    const form=el('form','task-composer'),input=el('input');input.id='draft-'+project.id;input.placeholder='Add a task…';input.setAttribute('aria-label','Add a task to '+project.name);input.maxLength=300;input.required=true;input.value=drafts.get(project.id)||'';input.oninput=()=>drafts.set(project.id,input.value);const submit=button('arrow','Add task','icon-button');submit.type='submit';form.append(input,submit);
    form.onsubmit=async e=>{e.preventDefault();const title=input.value.trim();if(!title)return;submit.disabled=true;try{await api('task',{requestId:crypto.randomUUID(),projectId:project.id,title});drafts.delete(project.id);input.value='';await refresh();$('draft-'+project.id)?.focus();}catch(error){toast(error.message);}finally{submit.disabled=false;}};
    body.append(items,form);card.append(head,body);list.append(card);
  });
  if(focusId?.startsWith('draft-')){const input=$(focusId);if(input){input.focus({preventScroll:true});input.setSelectionRange(selection,selection);}}
}
function modeHelp(){$('mode-help').textContent=$('control-mode').value==='browser'?'Separate browser · your mouse stays free':'Windows apps · uses your mouse and keyboard';$('instruction').placeholder=$('control-mode').value==='browser'?'Open neuvix.io and check the homepage…':'Open an app on my desktop…';}
function renderPC(){const active=state.runs.find(r=>['queued','running','waiting_approval'].includes(r.status));if(active){$('control-mode').value=active.mode||'desktop';modeHelp();}const device=pc();$('pc-name').textContent=device?.name||'Your computer';$('pc-status').textContent=!device?'Open Dooo on your PC to connect':!device.online?'PC offline':device.locked?'PC paused or Windows locked':busy()?'PC connected · request active':'PC connected';$('start-run').disabled=!canRun();$('refresh-screen').disabled=!canRun();$('control-mode').disabled=!!busy();$('approval-dot').hidden=!state.runs.some(r=>r.status==='waiting_approval');
  const recent=$('recent-runs');recent.replaceChildren();for(const run of state.runs.slice(0,12)){const b=el('button','',run.instruction==='[preview]'?'Screen preview':run.instruction);b.type='button';b.append(el('span','',labels[run.status]||run.status));b.onclick=()=>{runId=run.id;void refreshRun();};recent.append(b);}
}
const labels={queued:'Waiting for your PC',running:'Working on your PC',waiting_approval:'Waiting for you',review:'Ready to review',blocked:'Needs your attention',failed:'Could not finish',cancelled:'Stopped',completed:'Task complete'};
async function refreshRun(){if(!runId||!paired){$('run-view').hidden=true;$('approval').hidden=true;return;}try{
  runData=await api('run/'+runId);const {run,events,approval}=runData;$('run-view').hidden=false;$('run-state').textContent=labels[run.status]||run.status;$('run-instruction').textContent=(run.mode==='browser'?'Browser · ':'Desktop · ')+(run.instruction==='[preview]'?'Screen preview':run.instruction);$('run-summary').textContent=run.summary;
  $('stop-run').hidden=!['queued','running','waiting_approval'].includes(run.status);$('complete-run').hidden=run.status!=='review'||!run.task_id;
  $('approval').hidden=!approval;$('allow-action').disabled=false;$('deny-action').disabled=false;
  if(approval){$('approval-action').textContent=approval.description;const content=approval.action?.action_inputs?.content;$('approval-detail').hidden=!content;$('approval-detail').textContent=content||'';}
  const list=$('run-events');list.replaceChildren();for(const event of events.slice(-20))list.append(el('li','',event.summary));
  const target=$('action-target');target.hidden=true;
  if(approval?.action?.action_inputs?.start_box){try{const box=JSON.parse(approval.action.action_inputs.start_box);target.style.left=((box[0]+(box[2]??box[0]))/2*100)+'%';target.style.top=((box[1]+(box[3]??box[1]))/2*100)+'%';target.hidden=false;}catch{}}
  const img=$('pc-screen');img.onload=()=>{img.hidden=false;$('screen').style.minHeight='0';$('screen-empty').hidden=true;$('screen-caption').textContent=approval?'Screen for this action':run.mode==='browser'?'Background browser':'Windows desktop';};img.onerror=()=>{img.hidden=true;$('screen').style.minHeight='200px';$('screen-empty').hidden=false;};
  if(view==='pc')img.src='/api/mobile/frame/'+run.device_id+'?at='+Date.now();
}catch(e){$('connection-status').textContent=e.message;}}
async function refresh(){if(refreshing)return;refreshing=true;try{
  state=await api('state');paired=true;$('pair-view').hidden=true;$('workspace').hidden=false;$('connection-status').textContent='';
  renderProjects();renderPC();if(!runId)runId=state.runs.find(r=>['queued','running','waiting_approval'].includes(r.status))?.id||null;
  if(view==='pc')await refreshRun();
}catch(e){$('connection-status').textContent=e.message;if(!paired&&!$('pair-view').hidden){}else if(!paired){$('pair-view').hidden=false;toast('Connect to the internet to load Dooo.');}}
finally{refreshing=false;}}
async function start(instruction,taskId){if(!canRun()){toast(busy()?'Wait for the current request or stop it first.':'Open Dooo on your awake, unlocked PC.');showView('pc');return;}
  $('start-run').disabled=true;try{const data=await api('run',{requestId:crypto.randomUUID(),deviceId:pc().id,instruction,taskId,mode:$('control-mode').value});runId=data.run.id;$('instruction').value='';showView('pc');await refresh();}catch(e){toast(e.message);$('start-run').disabled=false;}}
async function notifications(){try{
  if(!('Notification'in window)||!('PushManager'in window)||!('serviceWorker'in navigator))throw new Error('Install Dooo on your Home Screen, then enable notifications.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notifications are off. Enable them in your browser or phone settings.');
  if(!state?.vapidPublicKey)throw new Error('Notifications are not configured yet.');
  const registration=await navigator.serviceWorker.ready;const key=state.vapidPublicKey;const bytes=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});await api('push',subscription.toJSON());toast('Approval notifications are on.');$('notification-help').textContent='Notifications are enabled for this phone.';
}catch(e){toast(e.message);}}
$('pair-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('pair',{code:$('pair-code').value,label:'Phone'});$('pair-code').value='';await refresh();}catch(error){toast(error.message);}finally{b.disabled=false;}};
$('tasks-tab').onclick=()=>showView('tasks');$('pc-tab').onclick=()=>showView('pc');$('settings-button').onclick=()=>showView('settings');$('close-settings').onclick=()=>showView('tasks');
$('add-project').onclick=()=>{$('project-form').hidden=!$('project-form').hidden;if(!$('project-form').hidden)$('project-name').focus();};
$('project-form').onsubmit=async e=>{e.preventDefault();try{await api('project',{name:$('project-name').value.trim()});$('project-name').value='';$('project-form').hidden=true;await refresh();}catch(error){toast(error.message);}};
$('control-mode').onchange=()=>{modeHelp();if(!busy()){runId=null;runData=null;$('pc-screen').hidden=true;$('action-target').hidden=true;$('screen-empty').hidden=false;$('screen').style.minHeight='200px';$('screen-caption').textContent='Refresh for a preview';void refreshRun();}};
$('control-form').onsubmit=e=>{e.preventDefault();void start($('instruction').value.trim());};$('refresh-screen').onclick=()=>start('[preview]');
$('stop-run').onclick=async()=>{try{await api('run/'+runId+'/stop',{});await refresh();}catch(e){toast(e.message);}};
async function answer(allow){const approvalId=runData?.approval?.id;if(!approvalId)return;$('allow-action').disabled=true;$('deny-action').disabled=true;try{await api('approval/'+approvalId,{allow});await refreshRun();}catch(e){toast(e.message);}}
$('allow-action').onclick=()=>answer(true);$('deny-action').onclick=()=>answer(false);
$('complete-run').onclick=async()=>{try{await api('run/'+runId+'/complete',{});await refresh();toast('Task marked done.');}catch(e){toast(e.message);}};
$('notify-button').onclick=notifications;$('settings-notifications').onclick=notifications;
$('logout').onclick=async()=>{try{await api('session',{},'DELETE');state=null;paired=false;runId=null;projectHash='';$('workspace').hidden=true;$('pair-view').hidden=false;}catch(e){toast(e.message);}};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install-button').hidden=false;});$('install-button').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install-button').hidden=true;}};
function readHash(){const params=new URLSearchParams(location.hash.slice(1));if(params.has('pair')){$('pair-code').value=params.get('pair');history.replaceState(null,'',location.pathname);}if(params.has('run')){runId=params.get('run');showView('pc');}}
window.addEventListener('hashchange',readHash);readHash();
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
void refresh();setInterval(()=>{if(paired&&document.visibilityState==='visible')void refresh();},3000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});window.addEventListener('online',()=>void refresh());
