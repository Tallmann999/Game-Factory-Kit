"use strict";
const connectedProject=location.pathname==="/project/" && /^https?:$/.test(location.protocol);
let projectData=null, projectRevision="",writeCount=0,editSequence=0,conflict=false;
let writeQueue=Promise.resolve();
function stageState(n) {
  if(!projectData && ((n.id==="platform" && !plan.platform) || (n.id==="work-mode" && !plan.workMode)))return {status:"planned",percent:0,documents:n.documents||[],remaining:[n.result]};
  return projectData?.stages[n.id] || {status:n.status,percent:n.status==="done"?100:n.status==="planned"?0:n.progress||0,
    documents:n.documents||[],remaining:n.status==="done"?[]:[n.remaining||n.result]};
}
function blockers(id) {
  return unfinishedInputs(plan,id,n=>stageState(n).status);
}
function nextProjectStage() {
  return ordered(plan).find(n=>stageState(n).status!=="done" && !blockers(n.id).length);
}
function openProjectStage(stage) {
  if(stage){centerNode(stage);openEditor(stage);}
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
    const changedData=!projectData || projectRevision!==data.revision || JSON.stringify(data.stages)!==JSON.stringify(projectData.stages) || JSON.stringify(data.features)!==JSON.stringify(projectData.features) || data.nextAction!==projectData.nextAction || JSON.stringify(data.stageRuns)!==JSON.stringify(projectData.stageRuns);
    projectData=data;projectRevision=data.revision;
    if(changedData || force){plan=upgradePlan(data.plan);render();}
    $("persist").textContent="Сохранено в папке игры";
    if(data.warnings.length)notice(data.warnings.join(" "));
    else if(force)notice("Документы и Feature Index сверены.");
    document.querySelector("main").inert=false;
    if(firstLoad){
      const current=ordered(plan).find(n=>stageState(n).status==="active");
      if(current)centerNode(current);
      window.dispatchEvent(new Event("gfk-project-ready"));
      const requested=nodeById(new URLSearchParams(location.search).get("stage"));
      const guided=new URLSearchParams(location.search).get("guided")==="1";
      openProjectStage(requested || (guided && nextProjectStage()));
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
    const next=nextProjectStage();
    $("openNextStage").hidden=!next;
    if(next)$("openNextStage").textContent="Открыть этап · "+next.title;
    const action=projectData.nextAction || (next?next.title+" · "+(stageState(next).remaining[0]||next.result):"");
    $("projectNext").hidden=!action;$("projectNext").textContent=action?"Следующий шаг · "+action.split(". ")[0]:"";
  }
  if(projectData){document.querySelector("h1").textContent=projectData.project;$("projectButton").textContent="Обновить анализ";$("continueChat").hidden=false;}
}
const formDraft=()=>new URLSearchParams(new FormData(form)).toString();
let savedStageDraft="";
function stageDetails(n) {
  const info=stageState(n), closed=blockers(n.id);
  form.elements.progress.value=info.percent;form.elements.status.value=info.status;
  form.elements.documents.value=(n.documents||[]).join("\n");form.elements.remaining.value=n.remaining||"";
  $("stageGate").textContent=closed.length?"Следующий запуск после: "+closed.map(n=>n.title).join(", "):"Предыдущие этапы пройдены или не требуются.";
  $("documentList").replaceChildren(...(info.documents.length?info.documents.map(name=>{
    const li=el("li");if(connectedProject && projectData?.stages[n.id]?.documents.includes(name)) {
      const a=el("a",name);a.href="/api/document?path="+encodeURIComponent(name);a.target="_blank";a.rel="noopener";li.append(a);
    }else li.textContent=name;
    for(const proof of info.evidence||[])if(proof.path===name)li.append(el("p",proof.fact));
    return li;
  }):[el("li","Пока нет документов.")]));
  const features=n.id==="build" && projectData?.features || [];
  $("featureDetails").hidden=!features.length;$("featureDetails").open=false;
  $("featureSummary").textContent="Фичи MVP · "+features.filter(f=>f.done).length+" из "+features.length+" приняты";
  const stateNames={ready:"готова к работе",working:"в работе",in_progress:"в работе",building:"в работе",planned:"в плане",specified:"описана",
    proposed:"предложена",implemented:"реализована",blocked:"заблокирована",review:"на ревью",question:"нужен ответ",push_pending:"ожидает push"};
  $("featureRows").replaceChildren(...features.map(f=>el("li",f.id+" · "+f.title+" — "+(f.done?"принята":stateNames[f.state]||f.state))));
  $("remainingList").replaceChildren(...(info.remaining.length?info.remaining:["Все критерии этапа выполнены."]).map(item=>el("li",item)));
  displayRun(n.id,projectData?.stageRuns?.[n.id]);
  savedStageDraft=formDraft();
}
let submitting=false, launchIntent=null,runtimeStatus=null;
const runActive=status=>["starting","running","stalled","cancelling"].includes(status);
const runConnection=new Map();
async function checkRuntime(){
  const response=await fetch("/api/runtime",{cache:"no-store"});
  if(!response.ok)throw Error("Не удалось проверить среду Codex.");
  runtimeStatus=await response.json();
  const stage=$("auditDialog").open?"@audit":$("detail").open?editing:null;
  if(stage)displayRun(stage,projectData?.stageRuns?.[stage]);
}
function runtimeDetails(info,diagnostics){
  const details=el("details"),summary=el("summary","Среда запуска Codex");details.append(summary);
  if(diagnostics){
    details.append(el("p","Пользователь: "+diagnostics.user+" · CLI: "+(diagnostics.version||"не проверен")),
      el("p",(diagnostics.command||[]).join(" ")),el("p","Профиль: "+diagnostics.profile+" · "+diagnostics.auth),
      el("p",diagnostics.available?"CLI и вход доступны. Ответ модели проверяется при выполнении.":diagnostics.reasons.join(" ")));
  }
  const check=el("button","Проверить среду");check.type="button";
  check.onclick=async()=>{check.disabled=true;try{await checkRuntime();}catch(e){notice(e.message);}finally{check.disabled=false;}};
  details.append(check);info.append(details);
}
function displayRun(stage,run){
  const isAudit=stage==="@audit", info=$(isAudit?"auditRunInfo":"stageRunInfo"),button=$(isAudit?"runAudit":"runStage");
  button.hidden=!connectedProject || !projectData?.stageRuns;
  const busy=submitting || runActive(run?.status) || (!isAudit && blockers(stage).length>0);
  button.disabled=busy || runtimeStatus?.available===false;
  const desktop=$(isAudit?"desktopAudit":"desktopStage");
  desktop.hidden=button.hidden || !projectData?.desktopChat;desktop.disabled=busy;
  const labels={draft:"Ждёт отправки в Codex",starting:"Запускается",running:"В работе",stalled:"Давно нет новых событий",cancelling:"Останавливается",cancelled:"Отменено",closed:"Чат отвязан",failed:"Ошибка запуска или выполнения",done:"Выполнено",partial:"Шаг выполнен",waiting:"Нужен ответ"};
  info.replaceChildren();
  if(!run){
    if(isAudit && projectData?.lastAudit)info.textContent="Последний аудит · "+new Date(projectData.lastAudit.date).toLocaleDateString("ru")+" · "+projectData.lastAudit.summary;
    if(!isAudit && connectedProject)info.textContent=projectData?.stageRuns?"При запуске задание сохранится и будет отправлено в чат этого этапа.":"Перезапустите сервер конструктора для запуска шагов.";
    if(connectedProject)runtimeDetails(info,runtimeStatus);
    return;
  }
  info.append(el("strong",labels[run.status]||run.status),el("p",run.message));
  if(run.mode!=="desktop"){
    runtimeDetails(info,runtimeStatus||run.diagnostics);
    if(runtimeStatus?.available===false)info.append(el("p",runtimeStatus.reasons.join(" ")));
    if(run.startedAt)info.append(el("p","Начало: "+new Date(run.startedAt).toLocaleTimeString("ru")+" · Последнее событие: "+new Date(run.lastEventAt||run.startedAt).toLocaleTimeString("ru")+" · Лимит: "+Math.round(run.timeoutSeconds/60)+" мин."));
    const log=el("a","Журнал задания ↗");log.href="/api/stage-log?"+new URLSearchParams({stage,run:run.id});log.target="_blank";log.rel="noopener";info.append(log);
    if(run.stderr){const details=el("details"),pre=el("pre",run.stderr);details.append(el("summary","Сообщения CLI"),pre);info.append(details);}
    if(runActive(run.status)){
      info.append(el("p","Это фоновый запуск. Новые сообщения видны здесь; открытый раньше времени чат может показывать только часть истории. Полный итог будет доступен после завершения."));
      const stop=el("button","Остановить задание");stop.type="button";
      stop.onclick=async()=>{
        stop.disabled=true;
        try{
          const response=await fetch("/api/stage-run/cancel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stageId:stage,requestId:run.id})});
          const result=await response.json();if(!response.ok)throw Error(result.error);
          projectData.stageRuns[stage]=result;displayRun(stage,result);notice(result.message);
        }catch(e){notice(e.message);stop.disabled=false;}
      };
      info.append(stop);
    }
    if(run.status==="cancelled")info.append(el("p","Исполнитель остановлен. Можно запустить шаг в чате Codex. Созданные до остановки файлы сохранены; проверьте их перед повтором."));
  }
  const connection=runConnection.get(stage),connectionLine=el("p");connectionLine.dataset.runConnection="true";
  if(connection)connectionLine.textContent=connection.error?"Связь с сервером потеряна. Последнее обновление: "+connection.at+". "+connection.error:"Обновлено: "+connection.at;
  info.append(connectionLine);
  if(run.opening)info.append(el("p",run.opening.message));
  if(run.status==="draft" && run.draftUrl?.startsWith("codex://new?")){
    const link=el("a","Открыть подготовленный чат ↗");link.href=run.draftUrl;info.append(link);
    const fallback=el("details"),summary=el("summary","Если браузер не открыл Codex");
    const draft=new URL(run.draftUrl).searchParams;
    const field=el("textarea");field.readOnly=true;field.rows=4;field.value=draft.get("prompt")||"";
    field.setAttribute("aria-label","Задание для нового чата");field.onfocus=()=>field.select();
    fallback.append(summary,el("p","Откройте новый чат в проекте "+draft.get("path")+", скопируйте и отправьте это задание."),field);
    info.append(fallback);
  }
  if(run.threadId){
    const link=el("a","Открыть чат Codex ↗");link.href="codex://threads/"+encodeURIComponent(run.threadId);info.append(link);
    const fallback=el("details");fallback.append(el("summary","Если чат не открылся"),el("p","Браузер может блокировать переход в приложение. Откройте Codex вручную. ID чата: "+run.threadId+". Журнал выше остаётся доступен; наличие ID ещё не подтверждает, что чат виден в текущем профиле Codex."));info.append(fallback);
  }
  if(run.mode==="desktop" && run.status==="running"){
    const detach=el("button","Отвязать чат от карточки");detach.type="button";
    detach.onclick=async()=>{
      try {
        const response=await fetch("/api/stage-run/detach",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({stageId:stage,requestId:run.id})});
        const result=await response.json();
        if(!response.ok)throw Error(result.error);
        projectData.stageRuns[stage]=result;displayRun(stage,result);
      }catch(e){notice(e.message);}
    };
    info.append(document.createTextNode(" "),detach);
  }
}
async function launchStep(next,stage,mode="auto"){
  if(submitting || conflict)return;
  const error=$(stage==="@audit"?"auditError":"detailError");
  submitting=true;editSequence++;error.textContent="";
  displayRun(stage,projectData.stageRuns[stage]);
  try{
    await writeQueue;
    if(conflict)throw Error("Обновите страницу после сохранения локальных правок.");
    const key=JSON.stringify([stage,mode,projectRevision,next]);
    if(launchIntent?.key!==key)launchIntent={key,id:crypto.randomUUID()};
    const response=await fetch("/api/stage-run",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({stageId:stage,requestId:launchIntent.id,revision:projectRevision,plan:next,mode})});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||"Не удалось запустить шаг.");
    launchIntent=null;plan=next;projectRevision=data.revision;projectData.stageRuns[stage]=data.run;
    if(data.run.status==="draft" && data.run.draftUrl?.startsWith("codex://new?"))location.href=data.run.draftUrl;
    if(stage!=="@audit"){selected=stage;editing=stage;pendingNew=null;}
    render();notice(data.run.message);await refreshProject(true);
    if(stage!=="@audit" && $("detail").open && editing===stage && nodeById(stage))stageDetails(nodeById(stage));
  }catch(e){error.textContent=e.message;}
  finally{submitting=false;displayRun(stage,projectData.stageRuns[stage]);}
}
async function pollRun(){
  const stage=$("auditDialog").open?"@audit":$("detail").open?editing:null;
  if(!stage || submitting || !["starting","running","stalled","cancelling","draft"].includes(projectData?.stageRuns?.[stage]?.status))return;
  try{
    const response=await fetch("/api/stage-run?stage="+encodeURIComponent(stage),{cache:"no-store"});
    if(!response.ok)throw Error("Сервер вернул "+response.status);
    const run=await response.json();
    runConnection.set(stage,{at:new Date().toLocaleTimeString("ru"),error:""});
    if(!run)return;
    const same=JSON.stringify(run)===JSON.stringify(projectData.stageRuns[stage]);
    if(same){
      const line=$(stage==="@audit"?"auditRunInfo":"stageRunInfo").querySelector("[data-run-connection]");
      if(line)line.textContent="Обновлено: "+runConnection.get(stage).at;
      return;
    }
    projectData.stageRuns[stage]=run;
    if(stage===($("auditDialog").open?"@audit":$("detail").open?editing:null))displayRun(stage,run);
    if(same || run.status==="draft" || runActive(run.status))return;
    if(stage==="@audit"){await refreshProject(true);return;}
    if(!$("detail").open || stage!==editing)return;
    if(formDraft()!==savedStageDraft){notice("Шаг завершён. Ваши правки в карточке сохранены до её закрытия.");return;}
    const seq=editSequence,data=await projectApi();
    if(seq!==editSequence || writeCount || !$("detail").open || stage!==editing || formDraft()!==savedStageDraft)return;
    projectData=data;projectRevision=data.revision;plan=upgradePlan(data.plan);render();
    const n=nodeById(stage);
    if(n){form.elements.report.value=n.report||"";stageDetails(n);}
  }catch(e){
    runConnection.set(stage,{at:runConnection.get(stage)?.at||"нет успешного обновления",error:e.message});
    if(stage===($("auditDialog").open?"@audit":$("detail").open?editing:null))displayRun(stage,projectData.stageRuns[stage]);
  }
}
function setupProjectView() {
  $("openNextStage").onclick=()=>openProjectStage(nextProjectStage());
  $("auditButton").hidden=!connectedProject;
  $("auditButton").onclick=()=>{displayRun("@audit",projectData?.stageRuns?.["@audit"]);$("auditError").textContent="";$("auditDialog").showModal();};
  $("runAudit").onclick=()=>launchStep(plan,"@audit");
  $("desktopAudit").onclick=()=>launchStep(plan,"@audit","desktop");
  if(connectedProject){
    checkRuntime().catch(e=>notice(e.message));
    setInterval(pollRun,2000);
    $("detail").addEventListener("close",()=>{if(projectData && !writeCount && !submitting)refreshProject(true);});
  }
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
