#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const {createHash,randomUUID}=require("node:crypto");
const {initialPlan,checkDiagram,ordered,choosePlatform,engines,devices,dimensions}=require("../docs/pipeline/model.js");
const {safeFile}=require("./robocop-board.cjs");
const {audit,docPath}=require("./project-audit.cjs");
const {git,boardDirectory}=require("./project-git.cjs");
const runs=require("./stage-run.cjs");
const kit=fs.realpathSync(path.join(__dirname,".."));
const ui=path.join(kit,"docs/pipeline");
const planPath=".game-factory/pipeline.json";
const hash=value=>createHash("sha256").update(value).digest("hex");
function gameRoot(folder) {
  const root=fs.realpathSync(folder);
  if(!fs.statSync(root).isDirectory() || root===kit || root.startsWith(kit+path.sep))throw Error("Укажите папку игры за пределами исходников набора.");
  return root;
}
function initialize(root) {
  const file=safeFile(root,planPath);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const locator=safeFile(root,".game-factory/kit-location.txt");
  if(!fs.existsSync(locator))try{fs.writeFileSync(locator,path.relative(root,kit)+"\n",{flag:"wx"});}catch(e){if(e.code!=="EEXIST")throw e;}
  if(!fs.existsSync(file)) {
    const plan=initialPlan();
    const state=safeFile(root,"docs/game/state.json");
    if(fs.existsSync(state)) {
      try {
        const s=JSON.parse(fs.readFileSync(state,"utf8"));
        const engine=engines.find(e=>e.toLowerCase()===String(s.prototype_platform).toLowerCase()) ||
          (/^(web|html)$/i.test(s.prototype_platform)?engines[0]:null);
        if(engine && devices.includes(s.target_device) && dimensions.includes(s.dimension))choosePlatform(plan,engine,s.target_device,s.dimension);
      } catch { /* The audit reports unreadable project state. */ }
    }
    const tmp=file+"."+randomUUID()+".tmp";
    fs.writeFileSync(tmp,JSON.stringify(plan,null,2)+"\n");
    try{fs.linkSync(tmp,file);}catch(e){if(e.code!=="EEXIST")throw e;}finally{fs.unlinkSync(tmp);}
  }
  return file;
}
function read(root) {
  const raw=fs.readFileSync(safeFile(root,planPath),"utf8");
  const plan=JSON.parse(raw.replace(/^\uFEFF/,""));checkDiagram(plan);ordered(plan);
  return {plan,revision:hash(raw)};
}
function save(root,revision,plan) {
  const file=safeFile(root,planPath), lock=file+".lock";
  const fd=fs.openSync(lock,"wx");
  const tmp=file+"."+randomUUID()+".tmp";
  try {
    const previous=read(root);
    if(previous.revision!==revision)throw Error("Схема изменилась в другой сессии. Скачайте свои правки в JSON и обновите страницу.");
    checkDiagram(plan);ordered(plan);
    if(previous.plan.gitTarget && JSON.stringify(previous.plan.gitTarget)!==JSON.stringify(plan.gitTarget) && fs.existsSync(path.join(boardDirectory(root,previous.plan.gitTarget),"owner.lock")))throw Error("Закройте доску фич предыдущей ветки перед сменой назначения.");
    const raw=JSON.stringify(plan,null,2)+"\n";if(hash(raw)===revision)return revision;
    fs.writeFileSync(tmp,raw,{flag:"wx"});fs.renameSync(tmp,file);
    return hash(raw);
  }finally{fs.rmSync(tmp,{force:true});fs.closeSync(fd);fs.unlinkSync(lock);}
}
function snapshot(root) {
  const data=read(root);
  const analysis=audit(root,data.plan),stageRuns=runs.recentRuns(root,data.plan);
  for(const [stage,run] of Object.entries(stageRuns))if(runs.active(run.status) && analysis.stages[stage])analysis.stages[stage].status="active";
  return {...data,project:path.basename(root),...analysis,stageRuns,desktopChat:true};
}
function handoff(root,data) {
  const {plan,stages,features,nextAction}=data;
  const open=ordered(plan).filter(n=>stages[n.id].status!=="done" && plan.edges.filter(e=>e.to===n.id).every(e=>stages[e.from].status==="done"));
  const sections=["# Продолжение работы над "+path.basename(root),"Работай в папке игры. Прочитай .game-factory/pipeline.json и документы текущего этапа.",
    "Завершено: "+plan.nodes.filter(n=>stages[n.id].status==="done").map(n=>n.title).join(", "),
    "Публикация: "+(plan.gitTarget?plan.gitTarget.remote+"/"+plan.gitTarget.branch:"обязательно спроси ветку и remote перед первой фичей")];
  if(nextAction)sections.push("Запись проекта: "+nextAction+(data.checkpoint?"\nИсточник: "+data.checkpoint:""));
  for(const n of open)sections.push(n.title+" · "+n.agent+" · "+stages[n.id].percent+"%\n"+[n.report,...stages[n.id].remaining,...stages[n.id].documents].filter(Boolean).join("\n"));
  if(features.length)sections.push("Фичи: "+features.filter(f=>f.done).length+"/"+features.length+"; открытые: "+features.filter(f=>!f.done).map(f=>f.id+" "+f.state).slice(0,30).join(", "));
  try {
    sections.push("HEAD: "+git(root,"log","-1","--format=%h %s"));
    const board=plan.gitTarget && path.join(boardDirectory(root,plan.gitTarget),"board.json");
    if(board && fs.existsSync(board)){
      for(const c of JSON.parse(fs.readFileSync(board,"utf8")).cards.filter(c=>c.state!=="done" && (c.work||c.question)).slice(0,5))
        sections.push([c.id+" · "+c.state,c.summary,c.question,c.handoff,c.work,c.sha].filter(Boolean).join("\n").slice(0,3000));
    }
  } catch { /* A new game can be opened before Git initialization. */ }
  sections.push("Продолжи с первого доступного этапа. Перед изменениями сверь файлы и Git. Сохрани решения и результаты в карточке проекта.");
  return sections.join("\n\n");
}
function serve(root,{port=0,launch}={}) {
  initialize(root);
  const assets=new Set(["index.html","model.js","app.js","skills.js","tour.js","tour.css","style.css","progress.css","project-view.js"]);
  const types={".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png",".webp":"image/webp",".jpg":"image/jpeg",".jpeg":"image/jpeg"};
  let origin,runtimeStatus;
  const server=http.createServer(async(req,res)=>{
    const send=(status,body,type="application/json; charset=utf-8")=>{
      res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"});res.end(body);
    };
    try {
      if(req.headers.host!==new URL(origin).host)return send(403,"{}");
      const url=new URL(req.url,origin);
      const startRun=req.method==="POST" && url.pathname==="/api/stage-run";
      const detachRun=req.method==="POST" && url.pathname==="/api/stage-run/detach";
      const cancelRun=req.method==="POST" && url.pathname==="/api/stage-run/cancel";
      if(startRun || detachRun || cancelRun || (req.method==="PUT" && url.pathname==="/api/project")) {
        if(req.headers.origin!==origin || req.headers["content-type"]!=="application/json")return send(403,"{}");
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024)return send(413,"{}");chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks));
        if(detachRun)return send(200,JSON.stringify(await require("./stage-chat.cjs").detach(root,body.stageId,body.requestId)));
        if(cancelRun)return send(200,JSON.stringify(await runs.cancel(root,body.stageId,body.requestId)));
        if(startRun)return send(202,JSON.stringify(runs.start(root,body,launch)));
        const {revision,plan}=body;
        const next=save(root,revision,plan);
        return send(200,JSON.stringify({revision:next}));
      }
      if(req.method!=="GET")return send(405,"{}");
      if(url.pathname==="/api/project")return send(200,JSON.stringify(snapshot(root)));
      if(url.pathname==="/api/stage-run")return send(200,JSON.stringify(runs.publicJob(runs.load(root,url.searchParams.get("stage")||""))));
      if(url.pathname==="/api/stage-log")return send(200,runs.logText(root,url.searchParams.get("stage")||"",url.searchParams.get("run")||""),"text/plain; charset=utf-8");
      if(url.pathname==="/api/runtime"){
        if(!runtimeStatus || Date.now()-Date.parse(runtimeStatus.checkedAt)>30000)runtimeStatus=require("./codex-runtime.cjs").preflight();
        return send(200,JSON.stringify(runtimeStatus));
      }
      if(url.pathname==="/api/handoff")return send(200,handoff(root,snapshot(root)),"text/plain; charset=utf-8");
      if(url.pathname==="/api/document"){
        const name=url.searchParams.get("path");
        const allowed=Object.values(snapshot(root).stages).some(s=>s.documents.includes(name));
        if(!allowed)return send(404,"{}");
        const file=docPath(root,name);
        if(fs.statSync(file).size>16*1024*1024)return send(413,"Документ больше 16 МБ.","text/plain; charset=utf-8");
        const ext=path.extname(file).toLowerCase();
        return send(200,fs.readFileSync(file),[".png",".webp",".jpg",".jpeg"].includes(ext)?types[ext]:"text/plain; charset=utf-8");
      }
      const name=url.pathname==="/project/"?"index.html":url.pathname.replace(/^\/project\//,"");
      if(!assets.has(name))return send(404,"{}");
      send(200,fs.readFileSync(path.join(ui,name)),types[path.extname(name)]+"; charset=utf-8");
    }catch(e){send(409,JSON.stringify({error:e.message}));}
  });
  server.listen(port,"127.0.0.1",()=>{
    origin="http://127.0.0.1:"+server.address().port;
    console.log("Конструктор "+path.basename(root)+": "+origin+"/project/");
  });
  return server;
}
function main(args) {
  if(!args.length || args.includes("--help")){console.log("node scripts/project.cjs <папка игры> [--port номер | --audit | --import-audit отчёт.json | --handoff | --record ID процент документ следующий-шаг]");return;}
  const [folder,mode,id,value,doc,...remaining]=args,root=gameRoot(folder);
  initialize(root);
  if(!mode)return serve(root);
  if(mode==="--port" && /^\d+$/.test(id) && Number(id)>0 && Number(id)<=65535)return serve(root,{port:Number(id)});
  if(mode==="--import-audit"){
    const result=JSON.parse(fs.readFileSync(id,"utf8").replace(/^\uFEFF/,""));
    if(value==="--run")runs.recoverAudit(root,doc,result);
    else if(value)throw Error("Для восстановления используйте --import-audit отчёт.json --run ID.");
    else require("./project-audit.cjs").saveReview(root,read(root).plan,result);
    return;
  }
  if(mode==="--audit")return console.log(JSON.stringify(snapshot(root),null,2));
  if(mode==="--handoff")return console.log(handoff(root,snapshot(root)));
  if(mode!=="--record")throw Error("Неизвестная команда. См. --help.");
  const data=read(root),n=data.plan.nodes.find(n=>n.id===id),pct=Number(value);
  if(!n || !Number.isInteger(pct) || pct<0 || pct>100 || !doc)throw Error("Нужны ID этапа, процент 0–100 и относительный путь к документу.");
  docPath(root,doc);
  n.progress=pct;n.status=pct===100?"done":pct===0?"planned":"active";
  n.documents=[...new Set([...(n.documents||[]),doc])];n.remaining=remaining.join(" ");
  save(root,data.revision,data.plan);console.log(n.title+" · "+pct+"%");
}
module.exports={initialize,read,save,snapshot,serve,handoff,gameRoot,planPath};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
