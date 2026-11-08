#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {spawnSync} = require("node:child_process");
const {createInterface} = require("node:readline/promises");
const {checkDiagram,verifyRoute,policies,statuses,extraSkills,assetOffer,engines,devices,dimensions,
  platformLabel,platformQuestion,choosePlatform,routedStages,selectMode} = require("../docs/pipeline/model.js");

function codexCommand() {
  const configured=process.env.GFK_CODEX_PATH;
  if(configured){
    if(!path.isAbsolute(configured) || !fs.existsSync(configured) || !fs.statSync(configured).isFile())
      throw Error("GFK_CODEX_PATH должен указывать на существующий абсолютный путь Codex CLI.");
    if(/\.(?:c?js|mjs)$/i.test(configured))return [process.execPath,configured];
    if(process.platform==="win32" && !/\.exe$/i.test(configured))throw Error("Для GFK_CODEX_PATH укажите codex.exe или codex.js, не .cmd/.ps1.");
    return [configured];
  }
  if (process.platform !== "win32") return ["codex"];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA,"npm"));
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue;
    const exe = path.join(dir,"codex.exe");
    if (fs.existsSync(exe)) return [exe];
  }
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue;
    const npmCli = path.join(dir,"node_modules","@openai","codex","bin","codex.js");
    if (fs.existsSync(npmCli)) return [process.execPath,npmCli];
  }
  throw new Error("Установите Codex CLI и добавьте его в PATH.");
}
function stagePrompt(plan,node,deps) {
  return [
    "Выполни один этап Game Factory Kit в текущей папке игры. Сначала прочитай её существующие документы и состояние.",
    "Этап: "+node.title, "Платформа: "+platformLabel(plan), "Исполнитель / скилл: "+node.agent,
    ...extraSkills(node,plan).map(name=>"Подключить скилл: "+name),
    ...assetOffer(plan,node),
    "Если указанный скилл недоступен, сообщи об этом. Используй разрешённые инструменты проекта.",
    "Задача: "+node.description, "Критерий приёмки: "+node.result, "Правило вопросов: "+policies[node.policy],
    "Документы этапа: "+(node.documents||[]).join(", "), "Следующий шаг: "+(node.remaining||node.result),
    "Предыдущая запись по этапу: "+(node.report||"нет"),
    "Входы: "+(deps.map(n=>n.title+" — "+(n.report||n.result)).join("\n")||"идея пользователя"),
    "Сохрани фактический результат в проекте, укажи путь и проведённую проверку. Затем заверши этот этап."
  ].join("\n");
}
async function main(args, services={}) {
  if (!args.length || args.includes("--help")) {
    console.log("Один этап за запуск. Нужны Node.js 20+ и интерактивный Codex CLI.\n"+
      "node scripts/run-pipeline.cjs <схема.json> --list\n"+
      "node scripts/run-pipeline.cjs <схема.json> --project <папка игры> [--stage <ID>]");
    return;
  }
  const [filename,mode,folder,stageFlag,stageId]=args;
  const list=mode==="--list" && args.length===2;
  if (!list && !(mode==="--project" && folder && (args.length===3 || (args.length===5 && stageFlag==="--stage"))))
    throw new Error("Проверьте параметры запуска: --help.");
  const file=fs.realpathSync(filename);
  if (fs.statSync(file).size>4*1024*1024) throw new Error("Схема больше 4 МБ.");
  let original=fs.readFileSync(file,"utf8");
  const plan=JSON.parse(original.replace(/^\uFEFF/,"")); checkDiagram(plan);
  const order=verifyRoute(plan);
  const inputs=n=>plan.edges.filter(e=>e.to===n.id).map(e=>order.find(d=>e.from===d.id));
  const canonical=path.basename(file)==="pipeline.json" && path.basename(path.dirname(file))===".game-factory";
  let observed=canonical?require("./project-audit.cjs").audit(path.dirname(path.dirname(file)),plan).stages:{};
  const status=n=>observed[n.id]?.status || n.status;
  const unlocked=n=>inputs(n).every(d=>status(d)==="done");
  if (list) {
    for (const n of order) console.log(n.id+"  "+n.title+"  —  "+statuses[status(n)]+
      (!plan.platform && routedStages.includes(n.id)?" · нужна платформа":status(n)==="planned" && unlocked(n)?" · можно начать":""));
    return;
  }
  const project=fs.realpathSync(folder), root=fs.realpathSync(path.join(__dirname,".."));
  if (!fs.statSync(project).isDirectory() || project===root || project.startsWith(root+path.sep))
    throw new Error("Выберите папку игры за пределами исходников набора.");
  if(canonical && path.dirname(path.dirname(file))!==project)throw Error("Схема привязана к другой папке игры.");
  const n=stageId?order.find(d=>d.id===stageId):order.find(d=>status(d)==="active" && unlocked(d))||
    order.find(d=>status(d)==="planned" && unlocked(d));
  if (!n) {
    if (stageId) throw new Error("Такого ID этапа нет в схеме.");
    console.log(order.every(d=>status(d)==="done")?"Все этапы завершены.":"Ожидается ответ. Для продолжения выберите этап через --stage ID."); return;
  }
  if (status(n)==="done" || !unlocked(n)) throw new Error("Этап уже завершён или его входы ещё не готовы.");
  if (!services.launch && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error("Для работы агента откройте интерактивный терминал.");
  const lock=file+".lock";
  const lockFd=fs.openSync(lock,"wx");
  function save() {
    if (fs.readFileSync(file,"utf8")!==original) throw new Error("JSON изменён другим редактором. Сверьте результаты вручную.");
    const next=JSON.stringify(plan,null,2)+"\n", tmp=file+"."+randomUUID()+".tmp";
    fs.writeFileSync(tmp,next,{flag:"wx"});
    try { fs.renameSync(tmp,file); original=next; } finally { fs.rmSync(tmp,{force:true}); }
  }
  // Close readline before giving the interactive terminal to Codex.
  async function ask(question) {
    if (services.ask) return services.ask(question);
    const rl=createInterface({input:process.stdin,output:process.stdout});
    try {return (await rl.question(question)).trim();} finally {rl.close();}
  }
  try {
    console.log(n.title+" · "+n.agent+"\n"+n.description+"\nРезультат: "+n.result);
    if(n.id==="work-mode") {
      const choice=await ask("Выберите режим: 1 — ручной, 2 — Робокоп, Enter — позже: ");
      if(!["1","2"].includes(choice)) return;
      selectMode(plan,choice==="1"?"manual":"robocop");save();return;
    }
    if(n.id==="build" && plan.workMode) {
      if(!plan.gitTarget){console.log("В какую ветку и какой remote отправлять фичи? Сохраните назначение в конструкторе.");return;}
      const report=require("./robocop-board.cjs").acceptedBuild(project,plan);
      if(report){
        n.status="done";n.report=report;save();console.log(report);return;
      }
      console.log("Откройте доску фич командой node scripts/robocop.cjs --help. После приёмки очереди зафиксируйте результат сборки в схеме.");
      return;
    }
    if (n.policy==="confirm" || n.status==="waiting") {
      if ((await ask("Можно начать этот этап? Введите «да»: ")).toLowerCase()!=="да") return;
    }
    if (!plan.platform && (n.id==="platform" || routedStages.includes(n.id))) {
      async function pick(question,choices) {
        const options=choices.map((name,i)=>(i+1)+". "+name).join(" / ");
        for (;;) {
          const answer=(await ask(question+" "+options+" (Enter — позже): ")).trim();
          if (!answer) return null;
          const match=choices.find((name,i)=>answer===String(i+1) || name.toLowerCase()===answer.toLowerCase());
          if (match) return match;
        }
      }
      const engine=await pick(platformQuestion,engines);if (!engine) return;
      const device=await pick("Для какого устройства?",devices);if (!device) return;
      const dimension=await pick("Какой будет игра?",dimensions);if (!dimension) return;
      choosePlatform(plan,engine,device,dimension);save();
      console.log("Платформа зафиксирована: "+platformLabel(plan));
      if (n.id==="platform") return;
    }
    const launch=services.launch || launchCodex;
    n.status="active";save();
    const result=launch(project,stagePrompt(plan,n,inputs(n)));
    if (result.error || result.status!==0) throw new Error("Сеанс Codex прерван. Этап сохранён в работе. "+(result.error?.message||""));
    const outcome=await ask("После проверки: 1 — готово, 2 — ждёт ответа, Enter — оставить в работе: ");
    if (outcome!=="1" && outcome!=="2") return;
    const report=await ask(outcome==="1"?"Укажите полученный результат или путь: ":"Какой вопрос остался? ");
    if (!report || report.length>3000) {console.log("Введите результат до 3000 символов в карточке. Этап остаётся в работе.");return;}
    n.report=report;n.status=outcome==="1"?"done":"waiting";save();
    console.log("Сохранено: "+statuses[n.status]+". Откройте обновлённый JSON в конструкторе.");
  } finally { fs.closeSync(lockFd);fs.unlinkSync(lock); }
}
function launchCodex(project,prompt) {
  const [bin,...prefix]=codexCommand();
  return spawnSync(bin,[...prefix,"-s","workspace-write","--",prompt],{cwd:project,stdio:"inherit",shell:false});
}
module.exports={main,codexCommand};
if (require.main===module) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
