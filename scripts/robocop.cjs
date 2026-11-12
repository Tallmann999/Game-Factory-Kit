#!/usr/bin/env node
"use strict";
const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
const {Board,safeFile}=require("./robocop-board.cjs");
const {platformLabel,upgradePlan,unfinishedInputs}=require("../docs/pipeline/model.js");
const mediaTypes={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".mp4":"video/mp4",".webm":"video/webm"};
function action(board,{type,id,value,previous}) {
  const card=board.cards.find(c=>c.id===id);
  if(type==="start"||type==="accept"){
    if(board.busy) throw Error("Исполнитель занят.");
    if(type==="accept" && !["review","push_pending"].includes(card?.state)) throw Error("Обновите карточку.");
    if(type==="start" && id && !board.ready().includes(card)) throw Error("Фича ещё недоступна.");
    if(type==="start" && !id && (board.data.mode==="manual"||!board.ready().length)) throw Error("Выберите доступную фичу.");
    if(type==="start" && board.data.mode==="manual" && board.cards.some(c=>c.state==="review")) throw Error("Сначала примите результат предыдущей фичи.");
    if(board.checkGate) board.checkGate();
    board.run(id,8,type==="accept").catch(e=>console.error(e.message));return;
  }
  if(type==="stop"){board.stop=true;return;}
  if(!card) throw Error("Выберите задачу.");
  if(board.activeId===id) throw Error("Дождитесь окончания текущей операции.");
  if(["working","publishing","push_pending","done","cut"].includes(card.state)) throw Error("Это действие сейчас недоступно.");
  if(type==="brief" && card.state==="ready") {
    if(previous!==card.brief) throw Error("Карточка изменилась. Откройте её повторно.");
    if(!value?.trim()) throw Error("Заполните бриф.");
    card.brief=value.trim();
  } else if(type==="defer" && card.state==="question") card.state="deferred";
  else if(type==="answer" && ["question","deferred","review"].includes(card.state)) {
    if(!value?.trim()) throw Error("Введите решение или правку.");
    if(card.sha && card.work){
      // The unmerged proposal stays on disk as staged changes for the next worker.
      const git=require("node:child_process").execFileSync;
      if(git("git",["-C",card.work,"rev-parse","HEAD"],{encoding:"utf8"}).trim()!==card.sha) throw Error("Сначала сверьте HEAD рабочей копии.");
      git("git",["-C",card.work,"reset","--soft",card.base]);
      git("git",["-C",card.work,"restore","--staged","--worktree","--",board.index]);card.sha="";
    }
    card.decisions.push([card.question||"Ревью",value.trim()].join("\n"));
    card.question="";card.state="ready";
  } else throw Error("Действие недоступно для этого статуса.");
  board.save();
}
function serve(board) {
  let origin;
  const server=http.createServer(async(req,res)=>{
    const send=(code,data,type="application/json; charset=utf-8")=>{
      res.writeHead(code,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; object-src 'none'"});res.end(data);
    };
    try {
      if(req.headers.host!==new URL(origin).host) return send(403,"{}");
      const url=new URL(req.url,origin);
      if(req.method==="POST" && url.pathname==="/action"){
        if(req.headers.origin!==origin || req.headers["content-type"]!=="application/json") return send(403,"{}");
        let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>48000) throw Error("Сообщение слишком длинное.");}
        action(board,JSON.parse(raw));return send(200,"{}");
      }
      if(req.method!=="GET") return send(405,"{}");
      if(url.pathname==="/board") {
        const ready=board.ready().map(c=>c.id);
        return send(200,JSON.stringify({mode:board.data.mode,target:board.target,platform:platformLabel(board.plan),busy:!!board.busy,
          ready,cards:board.cards.map(({id,title,state,priority,deps})=>({id,title,state,priority,deps}))}));
      }
      const card=board.cards.find(c=>c.id===url.searchParams.get("id"));
      if(card && url.pathname==="/card") {
        let progress="";
        if(card.state==="working" && card.work) {
          const checkpoint=safeFile(card.work,".robocop-handoff.md");
          if(fs.existsSync(checkpoint) && fs.statSync(checkpoint).size<65536)progress=fs.readFileSync(checkpoint,"utf8");
        }
        return send(200,JSON.stringify({...card,progress}));
      }
      if(card && url.pathname==="/media"){
        const name=url.searchParams.get("file"),type=mediaTypes[path.extname(name).toLowerCase()];
        if(!type || !card.media.includes(name)) return send(404,"{}");
        const file=safeFile(card.work || board.root,name);
        const stat=fs.statSync(file);if(!stat.isFile()) return send(404,"{}");
        res.writeHead(200,{"Content-Type":type,"Content-Length":stat.size,"X-Content-Type-Options":"nosniff"});
        const stream=fs.createReadStream(file);stream.on("error",()=>res.destroy());res.on("close",()=>stream.destroy());return stream.pipe(res);
      }
      const assets={"/":["board.html","text/html"],"/board.js":["board.js","text/javascript"],"/board.css":["board.css","text/css"]};
      if(!Object.hasOwn(assets,url.pathname)) return send(404,"{}");
      const [file,type]=assets[url.pathname];
      send(200,fs.readFileSync(path.join(__dirname,"../docs/robocop",file)),type+"; charset=utf-8");
    }catch(error){if(!res.headersSent)send(400,JSON.stringify({error:error.message}));}
  });
  server.listen(0,"127.0.0.1",()=>{
    origin="http://127.0.0.1:"+server.address().port;
    console.log("Доска Робокопа: "+origin+"\nПапка игры: "+board.root+"\nЗакройте сервер после завершения исполнителя.");
  });
  return server;
}
function main(args) {
  if(args.includes("--help")||!args.length) {
    console.log('node scripts/robocop.cjs <план.json> --project <папка игры> --check <программа> [аргументы проверки]\nНапример: --check node --test tests/game.test.cjs');return;
  }
  const [file,flag,root,verify,...check]=args;
  if(flag!=="--project" || verify!=="--check" || !check.length) throw Error("Укажите план, папку игры и команду проверки. См. --help.");
  const plan=JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
  upgradePlan(plan);
  const board=new Board(root,plan,check);
  const canonical=fs.realpathSync(file)===path.join(board.root,".game-factory","pipeline.json");
  if(canonical || plan.workflowVersion===2)board.checkGate=()=>{
    const data=canonical?require("./project.cjs").snapshot(board.root):{plan,stages:require("./project-audit.cjs").audit(board.root,plan).stages};
    if(JSON.stringify(data.plan.gitTarget)!==JSON.stringify(board.target) || data.plan.workMode!==board.data.mode ||
       platformLabel(data.plan)!==platformLabel(board.plan))throw Error("Назначение или режим изменились. Переоткройте доску.");
    const [blocked]=unfinishedInputs(data.plan,"build",n=>data.stages[n.id].status);
    if(blocked)throw Error("Сначала завершите этап «"+blocked.title+"».");
  };
  serve(board);
  process.once("exit",()=>board.close());
  for(const sig of ["SIGINT","SIGTERM"]) process.on(sig,()=>{
    if(board.busy){board.stop=true;console.log("Дождитесь окончания текущей фичи, затем закройте доску.");}
    else process.exit();
  });
}
module.exports={action,serve};
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
