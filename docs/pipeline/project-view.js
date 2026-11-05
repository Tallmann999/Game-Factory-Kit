"use strict";
const connectedProject=location.pathname==="/project/" && /^https?:$/.test(location.protocol);
let projectData=null, projectRevision="",writeCount=0,editSequence=0,conflict=false;
let writeQueue=Promise.resolve();
function stageState(n) {
  return projectData?.stages[n.id] || {status:n.status,percent:n.status==="done"?100:n.status==="planned"?0:n.progress||0,
    documents:n.documents||[],remaining:n.status==="done"?[]:[n.remaining||n.result]};
}
function blockers(id) {
  return plan.edges.filter(e=>e.to===id).map(e=>nodeById(e.from)).filter(n=>stageState(n).status!=="done");
}
async function projectApi(method="GET",body) {
  const response=await fetch("/api/project",{method,headers:body?{"Content-Type":"application/json"}:{},body,cache:"no-store"});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||"Не удалось открыть проект.");
  return result;
}
async function refreshProject(force=false) {
  if(conflict || writeCount || (!force && (document.hidden || gesture || document.querySelector("dialog[open]"))))return;
  const start=editSequence;
  try {
    const data=await projectApi();
    if(start!==editSequence || writeCount || gesture || (!force && document.querySelector("dialog[open]")))return;
    const firstLoad=!projectData;
    const changedData=!projectData || projectRevision!==data.revision || JSON.stringify(data.stages)!==JSON.stringify(projectData.stages) || JSON.stringify(data.features)!==JSON.stringify(projectData.features) || data.nextAction!==projectData.nextAction;
    projectData=data;projectRevision=data.revision;
    if(changedData || force){plan=addModeGate(data.plan);render();}
    $("persist").textContent="Сохранено в папке игры";
    if(data.warnings.length)notice(data.warnings.join(" "));
    else if(force)notice("Документы и Feature Index сверены.");
    document.querySelector("main").inert=false;
    if(firstLoad){
      const current=ordered(plan).find(n=>stageState(n).status==="active");
      if(current)centerNode(current);
      window.dispatchEvent(new Event("gfk-project-ready"));
    }
  } catch(e){$("persist").textContent="Не удалось прочитать проект";notice(e.message);}
}
function saveProject() {
  if(!projectData || conflict)return;
  const snapshot=JSON.stringify(plan);
  editSequence++;writeCount++;$("persist").textContent="Сохранение…";
  writeQueue=writeQueue.then(async()=>{
    if(conflict)return;
    const response=await projectApi("PUT",'{"revision":'+JSON.stringify(projectRevision)+',"plan":'+snapshot+'}');
    projectRevision=response.revision;
  }).catch(e=>{conflict=true;$("persist").textContent="Правки только в этой вкладке";notice(e.message+" Скачайте JSON для сохранения своих правок.");})
    .finally(()=>{writeCount--;if(!writeCount && !conflict)refreshProject(true);});
}
function releaseHeader() {
  const pct=Math.floor(plan.nodes.reduce((sum,n)=>sum+stageState(n).percent,0)/plan.nodes.length);
  $("releaseValue").textContent=pct+"%";$("releaseBar").value=pct;
  const f=projectData?.features||[];
  $("featureCount").textContent=f.length?"Фичи · "+projectData.doneFeatures+" из "+f.length+" · осталось "+(f.length-projectData.doneFeatures):"По этапам пайплайна";
  $("gitButton").textContent=plan.gitTarget?"Ветка · "+plan.gitTarget.remote+"/"+plan.gitTarget.branch:"Ветка для фич";
  if(projectData){
    const next=ordered(plan).find(n=>stageState(n).status!=="done" && !blockers(n.id).length);
    const action=projectData.nextAction || (next?next.title+" · "+(stageState(next).remaining[0]||next.result):"");
    $("projectNext").hidden=!action;$("projectNext").textContent=action?"Следующий шаг · "+action.split(". ")[0]:"";
  }
  if(projectData){document.querySelector("h1").textContent=projectData.project;$("projectButton").textContent="Обновить анализ";$("continueChat").hidden=false;}
}
function stageDetails(n) {
  const info=stageState(n), closed=blockers(n.id);
  form.elements.progress.value=info.percent;form.elements.status.value=info.status;
  form.elements.documents.value=(n.documents||[]).join("\n");form.elements.remaining.value=n.remaining||"";
  $("stageGate").textContent=closed.length?"Следующий запуск после: "+closed.map(n=>n.title).join(", "):"Предыдущие этапы пройдены или не требуются.";
  $("documentList").replaceChildren(...(info.documents.length?info.documents.map(name=>{
    const li=el("li");if(connectedProject && projectData?.stages[n.id]?.documents.includes(name)) {
      const a=el("a",name);a.href="/api/document?path="+encodeURIComponent(name);a.target="_blank";a.rel="noopener";li.append(a);
    }else li.textContent=name;return li;
  }):[el("li","Пока нет документов.")]));
  const features=n.id==="build" && projectData?.features || [];
  $("featureDetails").hidden=!features.length;$("featureDetails").open=false;
  $("featureSummary").textContent="Фичи MVP · "+features.filter(f=>f.done).length+" из "+features.length+" приняты";
  const stateNames={ready:"готова к работе",working:"в работе",in_progress:"в работе",building:"в работе",planned:"в плане",specified:"описана",
    proposed:"предложена",implemented:"реализована",blocked:"заблокирована",review:"на ревью",question:"нужен ответ",push_pending:"ожидает push"};
  $("featureRows").replaceChildren(...features.map(f=>el("li",f.id+" · "+f.title+" — "+(f.done?"принята":stateNames[f.state]||f.state))));
  $("remainingList").replaceChildren(...(info.remaining.length?info.remaining:["Все критерии этапа выполнены."]).map(item=>el("li",item)));
}
function setupProjectView() {
  $("projectButton").onclick=()=>connectedProject?refreshProject(true):$("projectHelp").showModal();
  $("continueChat").onclick=()=>window.open("/api/handoff","_blank","noopener");
  const gitForm=$("gitForm");
  $("gitButton").onclick=()=>{
    const options=projectData?.choices;
    gitForm.elements.branch.value=plan.gitTarget?.branch||options?.current||"";
    gitForm.elements.remote.value=plan.gitTarget?.remote||(options?.remotes.length===1?options.remotes[0]:"");
    for(const [id,values] of [["gitBranches",options?.branches],["gitRemotes",options?.remotes]])
      $(id).replaceChildren(...(values||[]).map(name=>new Option(name)));
    $("gitError").textContent=options && (!options.branches.length || !options.remotes.length)?"Для публикации нужны локальная ветка с первым коммитом и настроенный remote.":"";
    $("gitDialog").showModal();
  };
  gitForm.onsubmit=event=>{
    event.preventDefault();
    const target={branch:gitForm.elements.branch.value.trim(),remote:gitForm.elements.remote.value.trim()};
    const options=projectData?.choices;
    if(options && (!options.branches.includes(target.branch)||!options.remotes.includes(target.remote))){
      $("gitError").textContent="Выберите существующие ветку и remote этой игры.";return;
    }
    try {checkDiagram({...plan,gitTarget:target});}catch{$("gitError").textContent="Проверьте названия ветки и remote.";return;}
    plan.gitTarget=target;$("gitDialog").close();changed("Назначение сохранено. Для открытой доски фич завершите очередь и откройте доску с новым назначением.");
  };
  form.elements.progress.oninput=()=>{
    const pct=Number(form.elements.progress.value);
    form.elements.status.value=pct===100?"done":pct===0?"planned":"active";
  };
  form.elements.status.onchange=()=>{
    const status=form.elements.status.value;
    if(status==="done"||status==="planned")form.elements.progress.value=status==="done"?100:0;
    else if(Number(form.elements.progress.value)===100)form.elements.progress.value=0;
  };
  if(connectedProject) {
    document.querySelector("main").inert=true;refreshProject(true);
    setInterval(()=>refreshProject(),15000);
  }
}
