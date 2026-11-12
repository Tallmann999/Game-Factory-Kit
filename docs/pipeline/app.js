"use strict";
const $ = id => document.getElementById(id);
const nodeById = id => plan.nodes.find(n=>n.id===id);
const byId = (list,id) => list.find(item=>item.id===id);
const bound = value => Math.max(0,Math.min(50000,Math.round(value)));
const ns = "http://www.w3.org/2000/svg";
const guidedPreview=!connectedProject && new URLSearchParams(location.search).get("workflow")==="guided";
const storageKey = guidedPreview ? "game-factory-kit.pipeline.guided.v2" : "game-factory-kit.pipeline.v1";
const form = $("editorForm");
let plan = initialPlan(), scale = 1, selected = null, selectedWire = null, gesture = null;
let pendingNew = null, editing = null, blockedStorage = false;
function notice(text) { $("message").textContent = text; }
function el(tag,text,cls) {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text!==undefined) item.textContent = text;
  return item;
}
function svg(tag,attrs,parent=$("wires")) {
  const item = document.createElementNS(ns,tag);
  for (const [key,val] of Object.entries(attrs)) item.setAttribute(key,val);
  parent.append(item); return item;
}
function options(select,items) {
  select.replaceChildren(...Object.entries(items).map(([key,value])=>new Option(value,key)));
}
function persist() {
  if(connectedProject){saveProject();return;}
  try {
    if (blockedStorage) throw new Error();
    localStorage.setItem(storageKey,JSON.stringify(plan));
    $("persist").textContent = "Сохранено в браузере";
  } catch { $("persist").textContent = "Сохраните копию в JSON"; }
}
try {
  const saved = !connectedProject && localStorage.getItem(storageKey);
  if (saved) { const data=JSON.parse(saved); checkDiagram(data); ordered(data); plan=upgradePlan(data); }
  $("persist").textContent = saved ? "Сохранено в браузере" : "Локальная схема";
} catch {
  blockedStorage=true;
  notice("Локальная копия недоступна. Используйте сохранение в JSON.");
}
function tone(item,n) {
  item.style.setProperty("--tone",kinds[n.kind][2]);
  item.style.setProperty("--tint",kinds[n.kind][3]);
}
function renderCards() {
  const cards = [], buttons = [];
  for (const n of plan.nodes) {
    const [label,icon] = kinds[n.kind];
    const card = el("article",undefined,"card"+(selected===n.id?" selected":""));
    const info=stageState(n);
    card.dataset.id=n.id; card.dataset.status=info.status; card.tabIndex=0; card.setAttribute("role","button");
    card.setAttribute("aria-label",n.title+" — "+n.agent+" — "+statuses[info.status]+" · "+info.percent+"%"); tone(card,n);
    card.style.left=n.x+"px"; card.style.top=n.y+"px";
    const type = el("div",undefined,"type");
    type.append(el("span",icon,"glyph"),document.createTextNode(label));
    const title=el("h3",n.title); title.title=n.title;
    const skill=el("div","Скилл · "+n.agent,"skill-name"); skill.title=n.agent;
    card.append(type,title,skill,el("span",statuses[info.status]+(n.kind==="finish" && plan.platform?" · "+plan.engine:""),"state"));
    const health=el("div",undefined,"health"),meter=el("progress");meter.max=100;meter.value=info.percent;
    meter.setAttribute("aria-label","Выполнено: "+n.title);health.append(meter,el("small",info.percent+"%"));card.append(health);
    for (const side of sides) {
      const port=el("span",undefined,"port"); port.dataset.side=side;
      port.title="Потяните к точке другого этапа"; card.append(port);
    }
    card.onkeydown = event => { if (["Enter"," "].includes(event.key)) {event.preventDefault();openEditor(n);} };
    cards.push(card);
    const button=el("button"); tone(button,n); button.append(el("span",undefined,"swatch"),el("span",n.title));
    button.onclick=()=>{
      if (!$("skillsView").hidden) {openSkills(n.id);return;}
      showView("map");centerNode(n);openEditor(n);
    }; buttons.push(button);
  }
  $("cards").replaceChildren(...cards); $("outline").replaceChildren(...buttons);
  $("count").textContent = plan.nodes.length;
  releaseHeader();
  const done=plan.nodes.filter(n=>stageState(n).status==="done").length;
  $("amount").textContent=done+" / "+plan.nodes.length;
  $("progress").max=plan.nodes.length; $("progress").value=done;
}
function anchor(n,side) {
  return {x:n.x+({l:0,r:W,t:W/2,b:W/2}[side]), y:n.y+({l:H/2,r:H/2,t:0,b:H}[side])};
}
function point(p) { return p.x+" "+p.y; }
function control(p,side,dist) {
  return {x:p.x+({l:-1,r:1,t:0,b:0}[side])*dist,y:p.y+({l:0,r:0,t:-1,b:1}[side])*dist};
}
function drawWires() {
  const wires=$("wires"); wires.replaceChildren();
  const marker=svg("marker",{id:"arrow",viewBox:"0 0 10 10",refX:9,refY:5,markerWidth:7,markerHeight:7,orient:"auto"},svg("defs",{},wires));
  svg("path",{d:"M0 0 L10 5 L0 10 Z",fill:"#778574"},marker);
  for (const e of plan.edges) {
    const a=anchor(nodeById(e.from),e.out), port=anchor(nodeById(e.to),e.into);
    const b=control(port,e.into,8);
    const dist=Math.min(100,Math.max(32,Math.hypot(b.x-a.x,b.y-a.y)*.4));
    const c=control(a,e.out,dist), d=control(b,e.into,dist);
    const mid=e.bend || {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const path=e.bend ? "M"+point(a)+" Q"+point(c)+" "+point(mid)+" Q"+point(d)+" "+point(b)
      : "M"+point(a)+" C"+point(c)+" "+point(d)+" "+point(b);
    svg("path",{d:path,class:"wire","marker-end":"url(#arrow)"});
    const hit=svg("path",{d:path,fill:"none",class:"hit","data-edge":e.id});
    svg("title",{},hit).textContent="Перетащите линию, чтобы изменить изгиб. Нажмите для настройки концов.";
    if (selectedWire===e.id) {
      for (const [key,coord] of [["from",control(a,e.out,16)],["to",control(b,e.into,14)],["bend",mid]]) {
        svg("circle",{cx:coord.x,cy:coord.y,r:6,class:"handle","data-edge":e.id,"data-handle":key});
      }
    }
  }
  if (gesture?.type==="link" || gesture?.type==="endpoint") {
    svg("path",{d:"M"+point(gesture.origin)+" L"+point(gesture.pointer),class:"wire","stroke-dasharray":"6 4"});
  }
}
function bounds() {
  return {w:Math.max(...plan.nodes.map(n=>n.x+W),...plan.edges.map(e=>e.bend?.x||0))+60,
    h:Math.max(...plan.nodes.map(n=>n.y+H),...plan.edges.map(e=>e.bend?.y||0))+64};
}
function resizeWorld() {
  const {w,h}=bounds(), v=$("viewport");
  const width=Math.max(w,v.clientWidth/scale),height=Math.max(h,v.clientHeight/scale);
  $("world").style.cssText="width:"+width+"px;height:"+height+"px;transform:scale("+scale+")";
  $("extent").style.width=Math.ceil(width*scale)+"px"; $("extent").style.height=Math.ceil(height*scale)+"px";
  $("percent").value=Math.round(scale*100)+"%";
}
function renderTasks() {
  const rows=ordered(plan).map(n=>{
    const open=blockers(n.id), status=stageState(n).status;
    const needsPlatform=!plan.platform && routedStages.includes(n.id);
    const state=needsPlatform?"Нужна платформа":status!=="planned"?statuses[status]:open.length?"Ожидает входы":"Можно начать";
    const button=el("button",undefined,"job");
    button.append(el("span",n.title),el("b",state),el("small",n.agent+" · "+n.result),el("small",open.map(d=>d.title).join(", ")));
    button.onclick=()=>openEditor(n); return button;
  });
  $("tasks").replaceChildren(...rows);
}
function stageComposition(n) {
  return composition(n,routeSkills(plan,n.id)).filter(skill=>skill.lead || matchesPlatform(plan,n.id,skill.name));
}
function renderSkillGroups() {
  const stage=$("stageFilter").value;
  const query=$("skillSearch").value.trim().toLowerCase();
  const groups=[];
  for (const n of ordered(plan)) {
    if (stage && stage!==n.id) continue;
    const rows=stageComposition(n).filter(skill=>
      [skill.name,skill.task,n.title].some(text=>text.toLowerCase().includes(query)));
    if (!rows.length) continue;
    const group=el("section",undefined,"skill-group");
    const heading=el("h2",n.title);
    tone(group,n);
    const table=el("table"); table.setAttribute("aria-label","Скиллы этапа «"+n.title+"»");
    const head=table.createTHead().insertRow();
    for (const text of ["Скилл","Что делает на этом этапе","В задании"]) {
      const th=el("th",text); th.scope="col"; head.append(th);
    }
    const body=table.createTBody();
    const automatic=routeSkills(plan,n.id);
    const routed=!!plan.platform && routedStages.includes(n.id);
    let section="";
    for (const skill of rows) {
      if (routed) {
        const part=skill.lead || automatic.includes(skill.name)?"Маршрут · "+platformLabel(plan):"Дополнительно по задаче";
        if (part!==section) {
          section=part;
          const band=body.insertRow().insertCell();band.colSpan=3;band.className="route-band";band.textContent=part;
        }
      }
      const row=body.insertRow();
      const name=el("th");name.scope="row";name.append(el("code",skill.name));row.append(name);
      row.insertCell().textContent=skill.task;
      const role=row.insertCell();
      if (skill.lead) role.append(el("span","Основной","primary-role"));
      else if (automatic.includes(skill.name)) role.append(el("span","По платформе","primary-role"));
      else {
        const label=el("label"),check=el("input");
        check.type="checkbox";check.checked=extraSkills(n).includes(skill.name);
        check.setAttribute("aria-label","Подключить "+skill.name+" к этапу «"+n.title+"»");
        const caption=el("span",check.checked?"Подключён":"Подключить");
        check.onchange=()=>{
          const chosen=new Set(extraSkills(n));
          if (check.checked) chosen.add(skill.name); else chosen.delete(skill.name);
          n.skills=Array.from(chosen);
          caption.textContent=check.checked?"Подключён":"Подключить";
          persist();notice("Состав задания «"+n.title+"» сохранён.");
        };
        label.append(check,caption);role.append(label);
      }
    }
    group.append(heading);
    if (n.id==="platform") {
      const button=el("button",plan.platform?"Изменить платформу":platformQuestion);
      button.className="choose-platform";button.onclick=()=>openPlatform();group.append(button);
    }
    group.append(table);groups.push(group);
  }
  $("skillGroups").replaceChildren(...(groups.length?groups:[el("p","По вашему запросу скиллы не найдены.")]));
}
function openSkills(stage="") {
  showView("skills");
  $("stageFilter").value=stage;$("skillSearch").value="";
  renderSkillGroups();$("skillsView").scrollTop=0;
  if (stage==="platform") openPlatform();
  if (stage==="work-mode") openMode();
}
function populateStageFilter() {
  const selector=$("stageFilter"), previous=selector.value;
  selector.replaceChildren(new Option("Все этапы",""),...ordered(plan).map(n=>new Option(n.title,n.id)));
  if (nodeById(previous)) selector.value=previous;
}
function render() {
  $("switchRoute").hidden=connectedProject || (!guidedPreview && plan.workflowVersion===2);
  $("switchRoute").textContent=guidedPreview?"Вернуться к своей схеме":"Пошаговый старт";
  $("modeButton").hidden=!plan.platform;
  $("modeButton").textContent=plan.workMode?"Режим · "+workModes[plan.workMode]:"Выбрать режим работы";
  $("platformButton").textContent=plan.platform?platformLabel(plan):"Выбрать платформу";
  renderCards();resizeWorld();drawWires();renderTasks();
  if (!$("skillsView").hidden) {populateStageFilter();renderSkillGroups();}
}
function changed(text) { render();persist();if(text) notice(text); }
function showView(name) {
  for (const [id,view] of [["map","canvasArea"],["skills","skillsView"],["tasks","tasks"]]) {
    $(view).hidden=id!==name;$(id+"Tab").setAttribute("aria-pressed",id===name);
  }
  if (name==="map") resizeWorld();
  if (name==="skills") populateStageFilter();
  if (name==="tasks") renderTasks();
}
function centerNode(n) {
  const v=$("viewport"); v.scrollTo((n.x+W/2)*scale-v.clientWidth/2,(n.y+H/2)*scale-v.clientHeight/2);
}
function worldPoint(evt) {
  const rect=$("world").getBoundingClientRect();
  return {x:bound((evt.clientX-rect.left)/scale),y:bound((evt.clientY-rect.top)/scale)};
}
function openEditor(n,isNew=false) {
  $("detailMode").hidden=n.id!=="work-mode";
  editing=n.id; pendingNew=isNew?n:null;
  $("stageInfo").open=false;
  $("stageList").replaceChildren(...stageComposition(n).map(skill=>{
    const item=el("li");
    const role=skill.lead?"основной":routeSkills(plan,n.id).includes(skill.name)?"по платформе":extraSkills(n).includes(skill.name)?"подключён":"по задаче";
    item.append(el("code",skill.name),document.createTextNode(" · "+role),el("p",skill.task));
    return item;
  }));
  $("kind").textContent=kinds[n.kind][0]; $("detailTitle").textContent=isNew?"Новый этап":n.title;
  for (const field of ["title","description","agent","status","result","policy"]) form.elements[field].value=n[field];
  form.elements.report.value=n.report||"";
  form.elements.agent.readOnly=n.id==="build" && !!plan.platform;
  $("detailPlatform").hidden=n.id!=="platform";
  stageDetails(n);
  $("remove").hidden=isNew || ["start","finish"].includes(n.kind);
  $("detailError").textContent=""; $("detail").showModal();
  if (n.id==="platform" && !plan.platform && !blockers(n.id).length) openPlatform();
}
function connect(candidate,replaced=null) {
  const edges=plan.edges.filter(e=>e.id!==replaced);
  if(candidate.from===candidate.to || nodeById(candidate.from).kind==="finish" || nodeById(candidate.to).kind==="start")
    throw new Error("Связь должна вести от этапа к следующему.");
  if(edges.some(e=>e.from===candidate.from && e.to===candidate.to)) throw new Error("Такая связь уже есть.");
  edges.push(candidate); ordered({...plan,edges}); plan.edges=edges;
}
$("viewport").addEventListener("pointerdown",evt=>{
  if (evt.button!==0 || gesture) return;
  const target=evt.target, card=target.closest(".card"), wire=target.closest("[data-edge]");
  const p=worldPoint(evt), base={pointerId:evt.pointerId,start:p,clientX:evt.clientX,clientY:evt.clientY,moved:false};
  if (card) {
    const n=nodeById(card.dataset.id); selected=n.id;selectedWire=null;
    if(target.dataset.side) gesture={...base,type:"link",from:n.id,side:target.dataset.side,origin:anchor(n,target.dataset.side),pointer:p};
    else gesture={...base,type:"node",n,x:n.x,y:n.y};
  } else if(wire) {
    const e=byId(plan.edges,wire.dataset.edge); selectedWire=e.id;
    const end=wire.dataset.handle;
    if (end==="from" || end==="to") {
      const origin=end==="to"?anchor(nodeById(e.from),e.out):anchor(nodeById(e.to),e.into);
      gesture={...base,type:"endpoint",e,end,origin,pointer:p};
    } else gesture={...base,type:"bend",e,original:e.bend};
  } else {
    selectedWire=null;drawWires();
    if(evt.pointerType!=="mouse") return;
    gesture={...base,type:"pan",left:$("viewport").scrollLeft,top:$("viewport").scrollTop};
  }
  evt.preventDefault(); $("viewport").focus({preventScroll:true}); $("viewport").setPointerCapture(evt.pointerId);
  drawWires();
});
$("viewport").addEventListener("pointermove",evt=>{
  const g=gesture; if(!g || evt.pointerId!==g.pointerId) return;
  const dx=evt.clientX-g.clientX,dy=evt.clientY-g.clientY;
  if(!g.moved && Math.hypot(dx,dy)<4) return;
  g.moved=true;
  if(g.type==="pan") { $("viewport").scrollTo(g.left-dx,g.top-dy);return; }
  const p=worldPoint(evt);
  if(g.type==="node") {
    g.n.x=bound(g.x+p.x-g.start.x);g.n.y=bound(g.y+p.y-g.start.y);
    const card=$("cards").querySelector('[data-id="'+g.n.id+'"]');
    card.style.left=g.n.x+"px";card.style.top=g.n.y+"px";
  } else if(g.type==="bend") g.e.bend=p;
  else g.pointer=p;
  resizeWorld(); drawWires();
});
function finishGesture(evt,cancelled=false) {
  const g=gesture; if(!g || evt.pointerId!==g.pointerId) return;
  gesture=null;
  if($("viewport").hasPointerCapture(evt.pointerId)) $("viewport").releasePointerCapture(evt.pointerId);
  if(cancelled) {
    if(g.type==="node") {g.n.x=g.x; g.n.y=g.y;}
    if(g.type==="bend") g.e.bend=g.original;
    render();return;
  }
  if(g.type==="link" || g.type==="endpoint") {
    const target=document.elementFromPoint(evt.clientX,evt.clientY);
    const card=target?.closest(".card");
    if(card) {
      const n=nodeById(card.dataset.id), p=worldPoint(evt);
      const distance=s=>{const q=anchor(n,s);return Math.hypot(q.x-p.x,q.y-p.y);};
      const side=target.dataset.side || [...sides].sort((a,b)=>distance(a)-distance(b))[0];
      try {
        if(g.type==="link") connect(edge(g.from,n.id,g.side,side));
        else {
          const e={...g.e,[g.end]:n.id,[g.end==="from"?"out":"into"]:side};
          connect(e,e.id);
        }
        changed("Связь сохранена."); return;
      } catch(error) {notice(error.message);}
    } else notice("Отпустите конец стрелки на нужном блоке.");
  } else if(g.type==="node" && !g.moved) openEditor(g.n);
  else if(g.type==="bend") notice("Тяните крайние точки к другим блокам. Delete удаляет выбранную связь.");
  render(); if(g.moved && ["node","bend"].includes(g.type)) persist();
}
$("viewport").onpointerup=evt=>finishGesture(evt);
$("viewport").onpointercancel=evt=>finishGesture(evt,true);
$("viewport").onkeydown=evt=>{
  if(selectedWire && ["Delete","Backspace"].includes(evt.key)) {
    evt.preventDefault(); plan.edges=plan.edges.filter(e=>e.id!==selectedWire); selectedWire=null; changed("Связь удалена.");
  }
};
form.onsubmit=async evt=>{
  evt.preventDefault();const original=pendingNew||nodeById(editing), n={...original};
  for(const field of ["title","agent","description","status","result","policy","report"]) n[field]=form.elements[field].value.trim();
  if(n.id==="work-mode" && !plan.workMode && n.status==="done"){openMode();return;}
  if (!plan.platform && (n.id==="platform" || routedStages.includes(n.id)) && ["active","done"].includes(n.status)) {
    openPlatform();return;
  }
  const nodes=pendingNew?[...plan.nodes,n]:plan.nodes.map(d=>d.id===n.id?n:d);
  const prior=stageState(original), pct=Number(form.elements.progress.value);
  if(n.status!==prior.status || pct!==prior.percent) {
    const locked=blockers(n.id);
    if(locked.length && (pct>prior.percent || n.status==="done" || (prior.status==="planned" && n.status!=="planned"))){
      $("detailError").textContent="Сначала завершите: "+locked.map(n=>n.title).join(", ");return;
    }
    if(connectedProject && n.id==="build" && projectData.features.length && pct!==prior.percent){
      $("detailError").textContent="Прогресс сборки определяется принятыми F-ID из Feature Index.";return;
    }
    n.progress=n.status==="done"?100:n.status==="planned"?0:pct;
  } else n.status=original.status;
  n.documents=[...new Set(form.elements.documents.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
  n.remaining=form.elements.remaining.value.trim();
  const next={...plan,nodes};
  try {checkDiagram(next);ordered(next);} catch(error) {$("detailError").textContent=error.message;return;}
  if(["runStage","desktopStage"].includes(evt.submitter?.id)){
    await launchStep(next,n.id,evt.submitter.id==="desktopStage"?"desktop":"auto");return;
  }
  plan=next;selected=n.id;$("detail").close();changed("Этап сохранён.");
};
$("remove").onclick=()=>{
  if(!confirm("Удалить этап и его связи?")) return;
  plan.nodes=plan.nodes.filter(n=>n.id!==editing);plan.edges=plan.edges.filter(e=>e.from!==editing && e.to!==editing);
  selected=null;$("detail").close();changed("Этап удалён.");
};
document.querySelectorAll(".close").forEach(btn=>btn.onclick=()=>btn.closest("dialog").close());
$("add").onclick=()=>{
  showView("map");
  const v=$("viewport"); openEditor({id:makeId(),kind:"design",title:"Новый этап",description:"",agent:"game-creator",result:"Проверяемый результат этапа",
    x:bound((v.scrollLeft+v.clientWidth/2)/scale-W/2),y:bound((v.scrollTop+v.clientHeight/2)/scale-H/2),
    status:"planned",policy:"clarify"},true);
};
const platformForm=$("platformForm");
for (const [field,choices] of Object.entries({engine:engines,device:devices,dimension:dimensions})) {
  platformForm.elements[field].replaceChildren(new Option("Выберите…",""),...choices.map(choice=>new Option(choice,choice)));
}
let pendingBrief=false;
function updatePlatformPreview() {
  const {engine,device,dimension}=platformForm.elements;
  let text="После выбора конструктор подключит скиллы сборки, QA и передачи игры.";
  if (engine.value && device.value && dimension.value) {
    const draft={engine:engine.value,platform:{device:device.value,dimension:dimension.value}};
    const builder=builders[engines.indexOf(engine.value)];
    text="Сборка: "+builder+". "+(engine.value===engines[0] && dimension.value==="2D"?"Профиль Web 2D включает семь скиллов Phaser 4. ":"")+
      "Проверка: "+["game-qa",...routeSkills(draft,"qa")].join(", ")+".";
    if (plan.platform && platformLabel(draft)!==platformLabel(plan))
      text+=" При смене маршрута последующие этапы вернутся в план для повторной проверки.";
  }
  $("platformPreview").textContent=text;
}
function openPlatform(forBrief=false) {
  pendingBrief=forBrief;
  platformForm.elements.engine.value=plan.platform || plan.engine!==engines[0]?plan.engine:"";
  platformForm.elements.device.value=plan.platform?.device || "";
  platformForm.elements.dimension.value=plan.platform?.dimension || "";
  updatePlatformPreview();$("platformDialog").showModal();
}
$("platformButton").onclick=()=>openPlatform();
$("detailPlatform").onclick=()=>openPlatform();
platformForm.onchange=updatePlatformPreview;
platformForm.onsubmit=evt=>{
  evt.preventDefault();
  const {engine,device,dimension}=platformForm.elements;
  if(blockers("platform").length){
    $("platformPreview").textContent="Сначала завершите: "+blockers("platform").map(n=>n.title).join(", ");return;
  }
  choosePlatform(plan,engine.value,device.value,dimension.value);
  $("platformDialog").close();
  if ($("detail").open && editing==="platform") {
    form.elements.status.value="done";form.elements.report.value=nodeById("platform").report;
  }
  if ($("detail").open && editing==="build") {
    form.elements.agent.value=nodeById("build").agent;form.elements.agent.readOnly=true;
  }
  changed("Платформа зафиксирована. Скиллы следующих этапов обновлены.");
  if (pendingBrief) $("brief").click();
  else if (!$("skillsView").hidden) renderSkillGroups();
};
$("mapTab").onclick=()=>showView("map");
$("switchRoute").onclick=()=>{
  const url=new URL(location.href);
  if(guidedPreview){url.searchParams.delete("workflow");url.hash="";}
  else {url.searchParams.set("workflow","guided");url.hash="ftue";}
  location.assign(url);
};
$("tasksTab").onclick=()=>showView("tasks");
$("skillsTab").onclick=()=>openSkills();
$("stageFilter").onchange=()=>{
  renderSkillGroups();
  if ($("stageFilter").value==="platform") openPlatform();
  if ($("stageFilter").value==="work-mode") openMode();
};
$("skillSearch").oninput=renderSkillGroups;
function zoom(value,fit=false) {
  const v=$("viewport"),cx=(v.scrollLeft+v.clientWidth/2)/scale,cy=(v.scrollTop+v.clientHeight/2)/scale;
  scale=Math.max(.005,Math.min(2,value));resizeWorld();
  v.scrollTo(fit?0:cx*scale-v.clientWidth/2,fit?0:cy*scale-v.clientHeight/2);
}
$("minus").onclick=()=>zoom(Math.max(.1,scale/1.25)); $("plus").onclick=()=>zoom(scale*1.25);
$("fit").onclick=()=>{const b=bounds(),v=$("viewport");zoom(Math.min(1,(v.clientWidth-4)/b.w,(v.clientHeight-4)/b.h),true);};
function download(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=el("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("save").onclick=()=>download("game-pipeline.json",JSON.stringify(plan,null,2),"application/json");
$("load").onclick=()=>$("file").click();
$("file").onchange=async evt=>{
  const file=evt.target.files[0];evt.target.value="";if(!file) return;
  try {
    if(file.size>4*1024*1024) throw new Error("Файл больше 4 МБ.");
    const data=JSON.parse(await file.text());checkDiagram(data);ordered(data);
    if(!confirm("Заменить открытую схему содержимым JSON?")) return;
    plan=upgradePlan(data); selected=null;selectedWire=null;blockedStorage=false;changed("Схема открыта.");showView("map");$("fit").click();
  } catch(error) {notice("Не удалось открыть схему. "+error.message);}
};
$("brief").onclick=()=>{
  if (!plan.platform) {
    const locked=blockers("platform");
    if(locked.length){notice("Для полного брифа сначала завершите: "+locked.map(n=>n.title).join(", "));return;}
    openPlatform(true);return;
  }
  try {$("briefText").textContent=briefing(plan);$("handoff").showModal();}
  catch(error) {notice(error.message);}
};
$("downloadBrief").onclick=()=>download("game-pipeline.md",$("briefText").textContent,"text/markdown;charset=utf-8");
options(form.elements.status,statuses);options(form.elements.policy,policies);
function openMode() {
  if(blockers("work-mode").length){notice("Сначала завершите: "+blockers("work-mode").map(n=>n.title).join(", "));return;}
  if(!plan.platform){openPlatform();return;}
  $("queueNote").textContent=projectData?.executionNote||"";
  $("modeDialog").showModal();
}
$("detailMode").onclick=openMode;
$("modeButton").onclick=openMode;
for(const [button,mode] of [["manualMode","manual"],["autoMode","robocop"]]) {
  $(button).onclick=()=>{selectMode(plan,mode);$("modeDialog").close();if($("detail").open && editing==="work-mode")$("detail").close();changed("Режим сохранён. Скачайте JSON для доски фич.");};
}
for(const name of new Set([...skillCatalog.keys(),...plan.nodes.map(n=>n.agent),...builders])) $("roles").append(new Option(name,name));
setupProjectView();
new ResizeObserver(resizeWorld).observe($("viewport"));
render();
