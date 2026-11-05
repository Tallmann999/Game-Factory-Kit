"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {createHash,randomUUID}=require("node:crypto");
const {fork,spawn}=require("node:child_process");
const {createInterface}=require("node:readline");
const {safeFile}=require("./robocop-board.cjs");
const {audit,docPath}=require("./project-audit.cjs");
const {codexCommand}=require("./run-pipeline.cjs");
const {checkDiagram,ordered,platformLabel,extraSkills,policies}=require("../docs/pipeline/model.js");

const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const directory=".game-factory/stage-runs";
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
  if(job.status==="running" && job.pid) {
    try{process.kill(job.pid,0);}catch(e){if(e.code==="ESRCH"){
      job.status="failed";job.message="Исполнитель остановлен. Проверьте документы перед повторным запуском.";
    }}
  }
  return job;
}
function publicJob(job) {
  if(!job)return null;
  const {id,stage,status,task,threadId,message,documents,mode,draftUrl}=job;
  return {id,stage,status,task,threadId:status==="running" && mode!=="desktop"?"":threadId,message,documents,mode,
    draftUrl:status==="draft"?draftUrl:undefined};
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
  return {pid:child.pid,begin:id=>child.send({root,stage,id},()=>{if(child.connected)child.disconnect();})};
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
    if(previous?.status==="running")throw Error("Этот этап уже запущен. Откройте его текущий чат.");
    const analysis=audit(root,plan);
    const closed=plan.edges.filter(e=>e.to===stageId && analysis.stages[e.from].status!=="done");
    if(closed.length)throw Error("Сначала завершите: "+closed.map(e=>plan.nodes.find(n=>n.id===e.from).title).join(", "));
    const task=node.remaining?.trim() || node.description.trim() || node.result;
    const prompt=isAudit?["Используй $game-project-audit. Прочитай "+path.join(__dirname,"../skills/game-project-audit/SKILL.md")+".",
      "Работай только в этой игре. Исследуй существующие материалы, включая созданные до установки набора. Верни оценку каждого ID с путями и проверяемыми фактами. Конструктор сам сохранит отчёт. Файлы игры не редактируй.",
      "В evidence.path указывай точный относительный путь с /, без номера строки или #якоря. В fact запиши сам факт. Из скрытых каталогов допускается только .game-factory/pipeline.json для подтверждения выбора автора.",
      ...plan.nodes.map(n=>n.id+" · "+n.title+" · критерий: "+n.result+" · известные документы: "+analysis.stages[n.id].documents.join(", "))].join("\n"):makePrompt(plan,node,analysis,task);
    const next=isAudit?read(root).revision:save(root,revision,plan);
    if(isAudit && next!==revision)throw Error("Схема изменилась. Обновите проект перед аудитом.");
    if(mode==="desktop" && previous?.status==="draft" && previous.prompt===prompt && previous.revision===next)
      return {run:publicJob(previous),revision:next};
    const job={id:requestId,stage:stageId,mode,revision:next,task,prompt,status:"running",threadId:"",message:"Codex начинает работу. Чат с итогом откроется после завершения.",documents:[],
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
    try {
      const worker=launch(root,stageId);
      if(!worker.pid)throw Error("Не удалось запустить процесс Codex.");
      job.pid=worker.pid;store(file,job);worker.begin(job.id);
    }catch(e){job.status="failed";job.message=e.message;store(file,job);}
    return {run:publicJob(job),revision:next};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function openDesktop(id) {
  if(!uuid.test(id))throw Error("Некорректный ID чата.");
  const url="codex://threads/"+id;
  const [bin,...args]=process.platform==="win32"?["rundll32.exe","url.dll,FileProtocolHandler",url]:
    process.platform==="darwin"?["open",url]:["xdg-open",url];
  const child=spawn(bin,args,{stdio:"ignore",shell:false,windowsHide:true});
  child.on("error",()=>{});child.unref();
}
const chatAnswer="Заверши обычным сообщением на русском для автора игры. Кратко опиши результат, дай кликабельные Markdown-ссылки на все итоговые документы (абсолютные пути внутри проекта), укажи, что проверено и какой шаг следующий. Для исследования приложи ссылки на источники. По ходу сообщай о существенных находках.";
async function execute(root,job,onThread,onProgress) {
  const [bin,...prefix]=codexCommand();
  const out=safeFile(root,directory+"/"+job.id+".result.json");
  const isAudit=job.stage==="@audit";
  const helper=path.join(__dirname,"stage-chat.cjs");
  const args=[...prefix,...(job.stage==="research"?["--search"]:[]),"-a","never",
    "-c","mcp_servers.gfk_card.command="+JSON.stringify(process.execPath),
    "-c","mcp_servers.gfk_card.args="+JSON.stringify([helper,"mcp",job.stage,job.id,root]),
    "-c",'mcp_servers.gfk_card.tools.submit_result.approval_mode="approve"',
    "exec","--json","--sandbox",isAudit?"read-only":"workspace-write","--skip-git-repo-check","-"];
  await new Promise((resolve,reject)=>{
      const child=spawn(bin,args,{cwd:root,windowsHide:true,shell:false,stdio:["pipe","pipe","pipe"]});
      let error="";
      const lines=createInterface({input:child.stdout});
      lines.on("line",line=>{
        let event;try{event=JSON.parse(line);}catch{return;}
        if(event.type==="thread.started" && uuid.test(event.thread_id)) {
          try{onThread(event.thread_id);}catch(e){error=e.message;}
        }
        if(event.type==="item.completed" && event.item?.type==="agent_message" && event.item.text)onProgress(event.item.text);
        if(event.type==="turn.failed" || event.type==="error")error=String(event.error?.message||event.message||"").slice(-1200);
      });
      child.stderr.on("data",chunk=>{error=(error+chunk.toString()).slice(-1200);});
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
async function perform(root,stage,id,worker=execute,open=openDesktop) {
  const file=jobFile(root,stage),job=load(root,stage);
  if(job?.id!==id || job.status!=="running")return;
  try {
    const result=await worker(root,job,thread=>{
      if(job.threadId || !uuid.test(thread))return;
      job.threadId=thread;store(file,job);
    },message=>{job.message=message.slice(0,3000);store(file,job);});
    if(stage==="@audit")finishAudit(root,job,result);
    else await finishStage(root,job,result);
    fs.rmSync(safeFile(root,directory+"/"+job.id+".result.json"),{force:true});
  }catch(e){job.status="failed";job.message=(e.message||String(e)).slice(-1800);}
  store(file,job);
  if(job.mode!=="desktop" && job.threadId)open(job.threadId);
}
module.exports={start,perform,recentRuns,load,publicJob,recoverAudit,jobFile,store,directory,chatAnswer};
if(require.main===module)process.once("message",({root,stage,id})=>{
  perform(root,stage,id).catch(e=>{console.error(e.message);process.exitCode=1;});
});
