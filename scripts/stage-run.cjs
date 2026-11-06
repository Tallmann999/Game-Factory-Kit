"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {createHash,randomUUID}=require("node:crypto");
const {fork,spawn}=require("node:child_process");
const {createInterface}=require("node:readline");
const {safeFile}=require("./robocop-board.cjs");
const {audit,docPath}=require("./project-audit.cjs");
const {codexCommand}=require("./run-pipeline.cjs");
const runtime=require("./codex-runtime.cjs");
const {checkDiagram,ordered,platformLabel,extraSkills,policies}=require("../docs/pipeline/model.js");

const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const directory=".game-factory/stage-runs";
const active=status=>["starting","running","stalled","cancelling"].includes(status);
const setting=(name,fallback,min,max)=>Math.max(min,Math.min(max,Number(process.env[name])||fallback));
const now=()=>new Date().toISOString();
function jobFile(root,stage) {
  const name=createHash("sha256").update(stage).digest("hex");
  return safeFile(root,directory+"/"+name+".json");
}
function store(file,job) {
  const tmp=file+"."+randomUUID()+".tmp";
  try{fs.writeFileSync(tmp,JSON.stringify(job,null,2),{flag:"wx"});fs.renameSync(tmp,file);}
  finally{fs.rmSync(tmp,{force:true});}
}
function load(root,stage) {
  const file=jobFile(root,stage);
  if(!fs.existsSync(file))return null;
  const job=JSON.parse(fs.readFileSync(file,"utf8"));
  if(active(job.status) && job.mode!=="desktop" && job.pid) {
    try{process.kill(job.pid,0);}catch(e){if(e.code==="ESRCH"){
      job.status="stalled";job.message="Исполнитель не отвечает. Отмените запуск, чтобы проверить и остановить оставшиеся дочерние процессы.";
    }}
    const age=Date.now()-Date.parse(job.lastEventAt||job.startedAt||fs.statSync(file).mtime.toISOString());
    if(job.status!=="cancelling" && age>(job.stallSeconds||180)*1000)job.status="stalled";
  }
  return job;
}
function publicJob(job) {
  if(!job)return null;
  const {id,stage,status,task,threadId,message,documents,mode,draftUrl,startedAt,lastEventAt,heartbeatAt,phase,diagnostics,stderr,opening,timeoutSeconds}=job;
  return {id,stage,status,task,threadId,message,documents,mode,startedAt,lastEventAt,heartbeatAt,phase,diagnostics,stderr,opening,timeoutSeconds,
    pid:job.pid,cliPid:job.cli?.pid,
    draftUrl:status==="draft"?draftUrl:undefined};
}
function update(root,stage,id,change) {
  const file=jobFile(root,stage),lock=file+".lock";let fd;
  try {
    fd=fs.openSync(lock,"wx");const current=JSON.parse(fs.readFileSync(file,"utf8"));
    if(current.id!==id || !["starting","running"].includes(current.status))return false;
    change(current);store(file,current);return true;
  }catch(e){if(e.code==="EEXIST")return false;throw e;}
  finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
async function locked(root,stage,action,alreadyLocked=false) {
  if(alreadyLocked)return action();
  const lock=jobFile(root,stage)+".lock";let fd;
  for(let i=0;;i++)try{fd=fs.openSync(lock,"wx");break;}catch(e){
    if(e.code!=="EEXIST" || i===100)throw e;await new Promise(r=>setTimeout(r,100));
  }
  try{return await action();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function logEvent(root,job,event) {
  // Keep useful execution metadata; never persist command arguments, tool outputs or credentials.
  const record={at:now(),type:runtime.clean(event.type,100),itemType:runtime.clean(event.item?.type,100)};
  if(event.item?.type==="agent_message")record.message=runtime.clean(event.item.text);
  if(event.type==="stderr" || event.type==="error" || event.type==="turn.failed")record.message=runtime.clean(event.message||event.error?.message);
  const file=safeFile(root,directory+"/"+job.id+".events.jsonl");
  fs.appendFileSync(file,JSON.stringify(record)+"\n");
  if(fs.statSync(file).size>128000){const lines=fs.readFileSync(file,"utf8").split("\n");while(Buffer.byteLength(lines.join("\n"))>96000)lines.shift();fs.writeFileSync(file,lines.join("\n"));}
}
function logText(root,stage,id) {
  const job=load(root,stage);
  if(!uuid.test(id)||job?.id!==id)throw Error("Журнал относится к другой попытке.");
  const file=safeFile(root,directory+"/"+id+".events.jsonl");
  return fs.existsSync(file)?fs.readFileSync(file,"utf8"):"События пока не получены. Для старого запуска журнал мог не сохраняться.";
}
async function cancel(root,stage,id,reason="Остановлено пользователем.",stop=runtime.stopTree) {
  return locked(root,stage,async()=>{
    const file=jobFile(root,stage),job=load(root,stage);
    if(!uuid.test(id)||job?.id!==id)throw Error("Карточка уже содержит другой запуск.");
    if(job.status==="cancelled")return publicJob(job);
    if(job.mode==="desktop" || !active(job.status))throw Error("Отмена применима только к текущему автоматическому запуску.");
    if(!job.worker?.started)throw Error("У старого запуска нет сохранённого времени процесса. Нужна проверка владельца и дерева процессов перед ручным восстановлением; новый запуск пока запрещён.");
    job.status="cancelling";job.message="Останавливается только дерево этого задания…";store(file,job);
    try {
      if(job.cli)stop(job.cli);
      if(job.worker.pid!==process.pid)stop(job.worker);
      job.status="cancelled";job.phase="cancelled";job.message=reason;job.finishedAt=now();
    }catch(e){job.message="Не удалось подтвердить остановку: "+runtime.clean(e.message);}
    store(file,job);return publicJob(job);
  });
}
function recentRuns(root,plan) {
  if(!fs.existsSync(safeFile(root,directory)))return {};
  return Object.fromEntries([...plan.nodes.map(n=>n.id),"@audit"].map(id=>[id,publicJob(load(root,id))]).filter(([,run])=>run));
}
function makePrompt(plan,node,analysis,task) {
  const inputs=plan.edges.filter(e=>e.to===node.id).map(e=>plan.nodes.find(n=>n.id===e.from));
  const docs=new Set([...(analysis.stages[node.id].documents||[]),...inputs.flatMap(n=>analysis.stages[n.id].documents),
    ...(analysis.stages.idea?.documents||[]),...(analysis.stages.concept?.documents||[])]);
  return ["Выполни один шаг этапа «"+node.title+"» в текущей папке игры. Задание автора:",task,
    "Описание этапа: "+node.description,"Критерий завершения ВСЕГО этапа: "+node.result,
    "Скиллы: "+[node.agent,...extraSkills(node,plan)].join(", ")+". Прочитай инструкции нужного скилла в проекте, в установленных навыках или в клоне из .game-factory/kit-location.txt.",
    "Платформа: "+platformLabel(plan)+". Правило вопросов: "+policies[node.policy]+". Нажатие кнопки подтверждает старт этого шага.",
    "Исходные документы: "+([...docs].join("\n")||"найди в проекте"),"Входы: "+inputs.map(n=>n.title+" — "+(n.report||n.result)).join("\n"),
    "Текущий результат: "+(node.report||"пока нет")+". Прогресс этапа: "+analysis.stages[node.id].percent+"%.",
    node.id==="research"?"Сравни реальные игры, приложи ссылки и отдели наблюдения от проверяемой гипотезы. Сохрани выводы и предложения автору в документе исследования (например, docs/game/research.md). Авторский концепт меняется отдельным поручением.":"",
    "Сохрани результаты этого шага в общих документах игры. Соблюдай инструкции проекта. Не переходи к следующему этапу и не редактируй .game-factory. Реализацию и публикацию F-ID поручает доска фич с выбранной Git-веткой; не обходи её.",
    "Для карточки: status=done только когда выполнен критерий ВСЕГО этапа; partial если выполнена часть; waiting если нужен ответ автора. В summary укажи факт и проверку, в documents — реальные относительные пути к итоговым документам, в remaining — следующий шаг или вопрос, в progress — подтверждённый процент этапа."].filter(Boolean).join("\n\n");
}
function launchWorker(root,stage) {
  const child=fork(__filename,[],{cwd:root,detached:true,windowsHide:true,stdio:["ignore","ignore","ignore","ipc"],execArgv:[]});
  child.on("error",()=>{});child.unref();
  let record;
  try {record=runtime.identity(child.pid);if(!record)throw Error("Исполнитель завершился до регистрации.");}
  catch(e){child.kill();throw e;}
  return {pid:child.pid,identity:{...record,group:true},begin:id=>child.send({root,stage,id},()=>{if(child.connected)child.disconnect();})};
}
function start(root,{plan,revision,stageId,requestId,mode="auto"},launch=launchWorker) {
  if(typeof stageId!=="string" || !uuid.test(requestId))throw Error("Некорректный запуск этапа.");
  if(!["auto","desktop"].includes(mode))throw Error("Неизвестный способ запуска.");
  checkDiagram(plan);ordered(plan);
  const isAudit=stageId==="@audit";
  const node=isAudit?{id:stageId,description:"Провести аудит всех этапов проекта"}:plan.nodes.find(n=>n.id===stageId);
  if(!node)throw Error("Этап удалён.");
  const file=jobFile(root,stageId);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const lock=file+".lock",fd=fs.openSync(lock,"wx");
  try{
    const previous=load(root,stageId);
    const {read,save}=require("./project.cjs");
    if(previous?.id===requestId)return {run:publicJob(previous),revision:read(root).revision};
    if(active(previous?.status))throw Error("Этот этап уже запущен. Откройте текущий чат или отмените запуск перед повтором.");
    const analysis=audit(root,plan);
    const closed=plan.edges.filter(e=>e.to===stageId && analysis.stages[e.from].status!=="done");
    if(closed.length)throw Error("Сначала завершите: "+closed.map(e=>plan.nodes.find(n=>n.id===e.from).title).join(", "));
    const task=node.remaining?.trim() || node.description.trim() || node.result;
    const prompt=isAudit?["Используй $game-project-audit. Прочитай "+path.join(__dirname,"../skills/game-project-audit/SKILL.md")+".",
      "Работай только в этой игре. Исследуй существующие материалы, включая созданные до установки набора. Верни оценку каждого ID с путями и проверяемыми фактами. Конструктор сам сохранит отчёт. Файлы игры не редактируй.",
      "В evidence.path указывай точный относительный путь с /, без номера строки или #якоря. В fact запиши сам факт. Из скрытых каталогов допускается только .game-factory/pipeline.json для подтверждения выбора автора.",
      ...plan.nodes.map(n=>n.id+" · "+n.title+" · критерий: "+n.result+" · известные документы: "+analysis.stages[n.id].documents.join(", "))].join("\n"):makePrompt(plan,node,analysis,task);
    const diagnostics=mode==="auto" && launch===launchWorker?runtime.preflight():null;
    const next=isAudit?read(root).revision:save(root,revision,plan);
    if(isAudit && next!==revision)throw Error("Схема изменилась. Обновите проект перед аудитом.");
    if(mode==="desktop" && previous?.status==="draft" && previous.prompt===prompt && previous.revision===next)
      return {run:publicJob(previous),revision:next};
    const job={id:requestId,stage:stageId,mode,revision:next,task,prompt,status:"starting",threadId:"",message:"Фоновое задание запускается. Ход работы будет в карточке, ссылка на чат появится после его создания.",documents:[],
      startedAt:now(),lastEventAt:now(),phase:"starting",diagnostics,
      timeoutSeconds:setting("GFK_STAGE_TIMEOUT_SECONDS",1800,30,28800),stallSeconds:setting("GFK_STAGE_STALL_SECONDS",180,5,3600),
      original:{status:node.status,progress:node.progress,remaining:node.remaining,report:node.report}};
    if(mode==="desktop"){
      const helper=path.join(__dirname,"stage-chat.cjs");
      const brief="Этап «"+(isAudit?"Аудит проекта":node.title)+"». "+task.slice(0,300)+
        "\n\nНачни этот шаг в текущем чате проекта. Получи сохранённое задание командой\nnode \""+helper+"\" begin "+stageId+" "+requestId+
        "\nИспользуй инструкцию из вывода. Пиши ход работы, выводы и ссылки на документы здесь.";
      job.status="draft";job.message="Отправьте подготовленное сообщение в Codex. Ход работы и результат появятся в том же чате.";
      job.draftUrl="codex://new?"+new URLSearchParams({path:root,prompt:brief});
      store(file,job);return {run:publicJob(job),revision:next};
    }
    if(diagnostics && !diagnostics.available){
      job.status="failed";job.phase="preflight";job.message=diagnostics.reasons.join(" ");store(file,job);
      return {run:publicJob(job),revision:next};
    }
    try {
      const worker=launch(root,stageId);
      if(!worker.pid)throw Error("Не удалось запустить процесс Codex.");
      job.pid=worker.pid;job.worker=worker.identity;store(file,job);worker.begin(job.id);
    }catch(e){job.status="failed";job.message=e.message;store(file,job);}
    return {run:publicJob(job),revision:next};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
async function openDesktop(id) {
  if(!uuid.test(id))throw Error("Некорректный ID чата.");
  const url="codex://threads/"+id;
  const [bin,...args]=process.platform==="win32"?["rundll32.exe","url.dll,FileProtocolHandler",url]:
    process.platform==="darwin"?["open",url]:["xdg-open",url];
  await new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{stdio:"ignore",shell:false,windowsHide:true});
    const timer=setTimeout(()=>{child.kill();reject(Error("Обработчик ссылки Codex не ответил."));},10000);
    child.once("error",e=>{clearTimeout(timer);reject(e);});
    child.once("close",code=>{clearTimeout(timer);code===0?resolve():reject(Error("Обработчик ссылки завершился с кодом "+code));});
  });
}
const chatAnswer="Заверши обычным сообщением на русском для автора игры. Кратко опиши результат, дай кликабельные Markdown-ссылки на все итоговые документы (абсолютные пути внутри проекта), укажи, что проверено и какой шаг следующий. Для исследования приложи ссылки на источники. По ходу сообщай о существенных находках.";
async function execute(root,job,onThread,onProgress,onEvent=()=>{},onCli=()=>{}) {
  const [bin,...prefix]=job.diagnostics?.command?.length?job.diagnostics.command:codexCommand();
  const out=safeFile(root,directory+"/"+job.id+".result.json");
  const isAudit=job.stage==="@audit";
  const helper=path.join(__dirname,"stage-chat.cjs");
  const args=[...prefix,...(job.stage==="research"?["--search"]:[]),"-a","never",
    "-c","mcp_servers.gfk_card.command="+JSON.stringify(process.execPath),
    "-c","mcp_servers.gfk_card.args="+JSON.stringify([helper,"mcp",job.stage,job.id,root]),
    "-c",'mcp_servers.gfk_card.tools.submit_result.approval_mode="approve"',
    "exec","--json","--sandbox",isAudit?"read-only":"workspace-write","--skip-git-repo-check","-"];
  await new Promise((resolve,reject)=>{
      const child=spawn(bin,args,{cwd:root,detached:process.platform!=="win32",windowsHide:true,shell:false,stdio:["pipe","pipe","pipe"]});
      let error="";
      try {if(child.pid){const record=runtime.identity(child.pid);if(record)onCli({...record,group:true});}}
      catch(e){child.kill();error=e.message;}
      const lines=createInterface({input:child.stdout});
      lines.on("line",line=>{
        let event;try{event=JSON.parse(line);}catch{return;}
        onEvent(event);
        if(event.type==="thread.started" && uuid.test(event.thread_id)) {
          try{onThread(event.thread_id);}catch(e){error=e.message;}
        }
        if(event.type==="item.completed" && event.item?.type==="agent_message" && event.item.text)onProgress(event.item.text);
        if(event.type==="turn.failed" || event.type==="error")error=String(event.error?.message||event.message||"").slice(-1200);
      });
      child.stderr.on("data",chunk=>{error=(error+chunk.toString()).slice(-3000);onEvent({type:"stderr",message:runtime.clean(error)});});
      child.once("error",reject);
      child.once("close",code=>code===0?resolve():reject(Error(error||"Codex завершился с кодом "+code)));
      child.stdin.on("error",()=>{});child.stdin.end(job.prompt+"\n\nПеред заключительным ответом передай данные карточки инструменту gfk_card.submit_result. "+chatAnswer);
    });
  if(!fs.existsSync(out))throw Error("Исполнитель завершил чат, но не передал результат карточке. Откройте чат для просмотра.");
  if(fs.statSync(out).size>128000)throw Error("Отчёт Codex слишком большой.");
  return JSON.parse(fs.readFileSync(out,"utf8"));
}
function finishAudit(root,job,result) {
  require("./project-audit.cjs").saveReview(root,require("./project.cjs").read(root).plan,result);
  job.message=result.summary;job.status="done";store(jobFile(root,"@audit"),job);
}
function recoverAudit(root,id,result) {
  const file=jobFile(root,"@audit"),lock=file+".lock",fd=fs.openSync(lock,"wx");
  try {
    const job=load(root,"@audit");
    if(!job || !uuid.test(id) || job.id!==id || job.status!=="failed")throw Error("Для восстановления нужен ID последнего неудачного аудита.");
    finishAudit(root,job,result);
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
async function finishStage(root,job,result) {
    if(!["done","partial","waiting"].includes(result.status) || !Number.isInteger(result.progress) || result.progress<0 || result.progress>100 ||
      typeof result.summary!=="string" || !result.summary.trim() || typeof result.remaining!=="string" || !Array.isArray(result.documents) ||
      (result.status==="done" && !result.documents.length))throw Error("Codex вернул неполный отчёт по этапу.");
    job.documents=[...new Set(result.documents)].map(name=>{docPath(root,name);return name;});
    job.message=result.summary.slice(0,3000);
    const {read,save}=require("./project.cjs");
    for(let attempt=0;;attempt++) {
      const {plan,revision}=read(root),node=plan.nodes.find(n=>n.id===job.stage);
      if(!node)throw Error("Этап удалён во время выполнения.");
      node.documents=[...new Set([...(node.documents||[]),...job.documents])];
      if(node.report===job.original.report)node.report=job.message;
      if(node.remaining===job.original.remaining)node.remaining=result.remaining.slice(0,3000);
      if(node.status===job.original.status && node.progress===job.original.progress){
        node.status=({done:"done",partial:"active",waiting:"waiting"})[result.status];
        node.progress=result.status==="done"?100:Math.min(99,result.progress);
      }
      try{save(root,revision,plan);break;}catch(e){
        if(attempt>=5 || (e.code!=="EEXIST" && !e.message.includes("другой сессии")))throw e;
        await new Promise(r=>setTimeout(r,100*(attempt+1)));
      }
    }
    job.status=result.status;
}
async function perform(root,stage,id,worker=execute,open=openDesktop,alreadyLocked=false) {
  const file=jobFile(root,stage),job=load(root,stage);
  if(job?.id!==id || !["starting","running","stalled"].includes(job.status))return;
  let heartbeat;
  if(job.mode!=="desktop"){
    update(root,stage,id,j=>{j.status="running";j.phase="cli";j.heartbeatAt=now();});
    heartbeat=setInterval(()=>{
      update(root,stage,id,j=>{j.heartbeatAt=now();});
      if(job.worker && Date.now()-Date.parse(job.startedAt)>job.timeoutSeconds*1000)
        cancel(root,stage,id,"Превышен лимит времени задания. Проверьте документы и журнал перед повтором.").catch(()=>{});
    },10000);
  }
  try {
    const result=await worker(root,job,thread=>{
      if(!uuid.test(thread))return;
      update(root,stage,id,j=>{if(!j.threadId)j.threadId=thread;j.phase="responding";j.lastEventAt=now();});
    },message=>{update(root,stage,id,j=>{j.message=runtime.clean(message);j.lastEventAt=now();});},
    event=>{logEvent(root,job,event);update(root,stage,id,j=>{j.lastEventAt=now();if(event.type==="stderr")j.stderr=runtime.clean(event.message);});},
    cli=>{if(!update(root,stage,id,j=>{j.cli=cli;})){runtime.stopTree(cli);throw Error("Запуск закрыт до регистрации CLI.");}});
    await locked(root,stage,async()=>{
      const current=load(root,stage);
      if(current?.id!==id || !["starting","running","stalled"].includes(current.status))return;
      if(stage==="@audit")finishAudit(root,current,result);
      else await finishStage(root,current,result);
      current.finishedAt=now();current.phase="finished";store(file,current);
      fs.rmSync(safeFile(root,directory+"/"+id+".result.json"),{force:true});
    },alreadyLocked);
  }catch(e){await locked(root,stage,()=>{
    const current=load(root,stage);if(current?.id!==id || !["starting","running","stalled"].includes(current.status))return;
    current.status="failed";current.message=runtime.clean(e.message||e,1800);current.finishedAt=now();store(file,current);
  },alreadyLocked);}finally{clearInterval(heartbeat);}
  const current=load(root,stage);
  if(current?.id===id && current.mode!=="desktop" && current.threadId && !active(current.status) && current.status!=="cancelled"){
    let opening;
    try{await open(current.threadId);opening={status:"requested",message:"Ссылка передана системе. Если окно не появилось, откройте чат по ссылке или найдите ID в Codex."};}
    catch(e){opening={status:"failed",message:runtime.clean(e.message)};}
    await locked(root,stage,()=>{const latest=load(root,stage);if(latest?.id===id){latest.opening=opening;store(file,latest);}});
  }
}
module.exports={start,perform,recentRuns,load,publicJob,recoverAudit,jobFile,store,directory,chatAnswer,active,cancel,logText};
if(require.main===module)process.once("message",({root,stage,id})=>{
  perform(root,stage,id).catch(e=>{console.error(e.message);process.exitCode=1;});
});
