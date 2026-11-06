"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {randomUUID,createHash} = require("node:crypto");
const {spawn} = require("node:child_process");
const {git,requireTarget,boardDirectory} = require("./project-git.cjs");
const {codexCommand} = require("./run-pipeline.cjs");
const {checkDiagram,verifyRoute,platformLabel,extraSkills} = require("../docs/pipeline/model.js");

const {parseIndex,verifiedIndex}=require("./feature-index.cjs");
function sourcePath(root,plan,stage,defaults) {
  for(const name of [...(plan.nodes.find(n=>n.id===stage)?.documents||[]),...defaults]){
    if(!/\.md$/i.test(name))continue;
    const file=safeFile(root,name);
    if(fs.existsSync(file) && (stage!=="scope" || /^\s*\|\s*F-\d+/im.test(fs.readFileSync(file,"utf8"))))return name;
  }
  return defaults[0];
}
function indexPath(root,plan) {return sourcePath(root,plan,"scope",["docs/game/feature-index.md","docs/feature-index.md","feature-index.md"]);}
function command(argv,cwd,timeout,input="") {
  return new Promise((resolve,reject)=>{
    if (timeout<=0) return reject(Error("Истекло время запуска."));
    const child=spawn(argv[0],argv.slice(1),{cwd,shell:false,windowsHide:true,
      detached:process.platform!=="win32",stdio:["pipe","pipe","pipe"]});
    let tail="",expired=false;
    const collect=chunk=>{tail=(tail+chunk.toString()).slice(-6000);};
    child.stdout.on("data",collect);child.stderr.on("data",collect);
    child.stdin.on("error",()=>{});child.stdin.end(input);
    const timer=setTimeout(()=>{
      expired=true;
      if(process.platform==="win32") spawn("taskkill",["/pid",String(child.pid),"/t","/f"],{windowsHide:true,stdio:"ignore"});
      else {try{process.kill(-child.pid,"SIGKILL");}catch{}}
    },timeout);
    child.once("error",e=>{clearTimeout(timer);reject(e);});
    child.once("close",code=>{clearTimeout(timer);if(code===0&&!expired) resolve(tail);
      else reject(Error(expired?"Истекло время запуска.":tail||"Процесс завершён с кодом "+code));});
  });
}
async function codexWorker(card,brief,timeout,dir) {
  const out=path.join(dir,randomUUID()+".json");
  try {
    await command([...codexCommand(),"-a","never","exec","-s","workspace-write","--output-schema",
      path.join(__dirname,"robocop-result.json"),"-o",out,"-"],card.work,timeout,brief);
    return JSON.parse(fs.readFileSync(out,"utf8"));
  } finally {fs.rmSync(out,{force:true});}
}
function targetHead(root,target) {
  requireTarget(root,target);
  if (git(root,"status","--porcelain","--untracked-files=no")) throw Error("Перед записью в выбранную ветку сохраните изменения отслеживаемых файлов.");
  return git(root,"rev-parse","HEAD");
}
function safeFile(folder,name) {
  folder=path.resolve(folder);
  if(typeof name!=="string" || !name || /[:\\\x00-\x1f]/.test(name) || path.isAbsolute(name) ||
    name.split("/").some(s=>!s || s==="." || s===".." || s.toLowerCase()===".git")) throw Error("Недопустимый путь файла.");
  const file=path.join(folder,name);
  for(let p=file;p!==folder;p=path.dirname(p)) {
    if(fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error("Ссылка за пределы рабочей копии запрещена.");
  }
  return file;
}
const sourceSignature=c=>createHash("sha256").update(JSON.stringify([c.title,c.priority,c.deps,c.brief,c.state])).digest("hex");
function sameSource(saved,fresh) {
  // A feature commit edits only its status column in the author's index.
  return saved.source===sourceSignature(fresh) || (saved.sha && fresh.state==="done" &&
    ["ready","question"].some(state=>saved.source===sourceSignature({...fresh,state})));
}
function acceptedBuild(project,plan) {
  requireTarget(project,plan.gitTarget);
  const file=path.join(boardDirectory(project,plan.gitTarget),"board.json");
  if(!fs.existsSync(file))return "";
  const board=JSON.parse(fs.readFileSync(file,"utf8"));
  if(board.platform!==platformLabel(plan))return "";
  const source=parseIndex(git(project,"show","HEAD:"+indexPath(project,plan)));
  const scope=source.filter(c=>c.priority!=="later" && c.state!=="cut");
  const accepted=[];
  for(const initial of scope){
    const c=board.cards.find(item=>item.id===initial.id);
    if(!c || !sameSource(c,initial) || c.state!=="done")return "";
    if(c.sha && (!c.pushed || !git(project,"branch","--list",plan.gitTarget.branch,"--contains",c.sha)))return "";
    accepted.push(c.id+" "+(c.sha||"verified").slice(0,8));
  }
  return accepted.length?"Принятые фичи: "+accepted.join(", "):"";
}
class Board {
  constructor(root,plan,check,{worker=codexWorker}={}) {
    this.root=fs.realpathSync(root);
    if(fs.realpathSync(git(root,"rev-parse","--show-toplevel"))!==this.root) throw Error("Укажите корень Git-проекта игры.");
    const kit=fs.realpathSync(path.join(__dirname,".."));
    if(this.root===kit || this.root.startsWith(kit+path.sep)) throw Error("Выберите игру за пределами набора.");
    targetHead(root,plan.gitTarget);
    this.target={...plan.gitTarget};
    checkDiagram(plan);verifyRoute(plan);
    if (!plan.platform || !["manual","robocop"].includes(plan.workMode)) throw Error("В конструкторе подтвердите платформу и выберите режим работы.");
    this.plan=plan;this.check=check;this.worker=worker;
    this.dir=boardDirectory(root,this.target);
    fs.mkdirSync(this.dir,{recursive:true});
    this.file=path.join(this.dir,"board.json");
    this.lock=path.join(this.dir,"owner.lock");
    if(fs.existsSync(this.lock)) throw Error("Доска уже открыта или была прервана. PID владельца в "+this.lock);
    const lock=fs.openSync(this.lock,"wx");fs.writeFileSync(lock,String(process.pid));fs.closeSync(lock);
    try {
      this.index=indexPath(root,plan);
      this.concept=sourcePath(root,plan,"concept",["docs/game/concept.md","GAME_CONCEPT.md","docs/project-concept.md"]);
      if(!git(root,"show","HEAD:"+this.concept)) throw Error("Добавьте авторский concept.md в выбранную ветку игры.");
      const imported=parseIndex(git(root,"show","HEAD:"+this.index));
      for(const c of imported)c.source=sourceSignature(c);
      const legacyDir=path.dirname(this.dir);
      const legacyFile=path.join(legacyDir,"board.json");
      const migrate=this.target.branch==="main" && !fs.existsSync(this.file) && fs.existsSync(legacyFile);
      if(migrate && fs.existsSync(path.join(legacyDir,"owner.lock"))) throw Error("Закройте предыдущую доску.");
      if(fs.existsSync(this.file) || migrate) {
        this.data=JSON.parse(fs.readFileSync(migrate?legacyFile:this.file,"utf8"));
        if(migrate) for(const card of this.cards) if(card.sha && card.state==="done") card.state="push_pending";
        if(this.data.platform!==platformLabel(plan)) throw Error("Маршрут проекта изменён. Для нового маршрута архивируйте доску по инструкции в docs/ROBOCOP.md.");
        const incoming=new Map(imported.map(c=>[c.id,c]));
        for(const existing of this.cards) {
          const fresh=incoming.get(existing.id);
          if(!fresh || !sameSource(existing,fresh)) throw Error("Изменился существующий "+existing.id+". Уточняйте бриф в карточке, для нового объёма добавьте F-ID или архивируйте доску.");
          incoming.delete(existing.id);
        }
        this.cards.push(...incoming.values());
      } else this.data={platform:platformLabel(plan),cards:imported};
      this.data.mode=plan.workMode;this.data.target=this.target;
      for(const c of this.cards) {
        if(c.state==="committing"){
          const head=git(c.work,"rev-parse","HEAD");
          if(head!==c.base && git(c.work,"show","-s","--format=%P %T",head)===c.base+" "+c.tree){
            c.sha=head;c.state="review";
          } else {c.state="question";c.question="Коммит прерван. Проверьте рабочую копию и продолжите фичу.";}
        }
        if(c.state==="publishing" && c.sha && git(root,"branch","--contains",c.sha,"--list",this.target.branch)) c.state="push_pending";
        if(["working","publishing"].includes(c.state)) {c.state="question";c.question="Запуск был прерван. Проверьте рабочую копию и разрешите продолжение.";}
      }
      this.save();
    } catch(e) {this.close();throw e;}
  }
  get cards(){return this.data.cards;}
  save(){
    const events=[];
    for(const c of this.cards) if(c.notifiedState!==c.state){
      if(["question","review","done"].includes(c.state))events.push(c.id+" · "+({question:"нужно решение",review:"на ревью",done:"готово"})[c.state]);
      c.notifiedState=c.state;
    }
    const tmp=this.file+".tmp";fs.writeFileSync(tmp,JSON.stringify(this.data,null,2));fs.renameSync(tmp,this.file);
    events.forEach(message=>console.log(message));
  }
  close(){fs.unlinkSync(this.lock);}
  ready(){if(this.cards.some(c=>c.state==="push_pending"))return [];return this.cards.filter(c=>c.state==="ready" && c.priority!=="later" &&
    c.deps.every(d=>this.cards.some(dep=>dep.id===d && dep.state==="done"))).sort((a,b)=>a.priority.localeCompare(b.priority));}
  prompt(c) {
    const build=this.plan.nodes.find(n=>n.id==="build");
    return [c.id+" — "+c.title,
      "Ты исполнитель фичи. Выполни только "+c.id+" в текущей изолированной рабочей копии.",
      "Назначение принятой фичи: "+this.target.remote+"/"+this.target.branch+".",platformLabel(this.plan),build?"Навыки по задаче: "+[build.agent,...extraSkills(build,this.plan)].join(", "):"",
      "Прочитай "+this.concept+", "+this.index+" и относящиеся к фиче документы. Авторские механики и пиллары имеют приоритет.",
      c.brief,"Принятые решения: "+c.decisions.join("\n"),"Продолжение: "+c.handoff,
      "Проверь git diff и уже сделанное. Исходные концепт и Feature Index служат входами. Не меняй ветки, историю Git, не коммить и не публикуй. Верни явный список изменённых файлов фичи без .robocop-handoff.md.",
      "Перед реализацией оцени, достаточно ли контекста на этот F-ID, нужные документы, проверку и summary. Повтори оценку после проверяемых подшагов. При достаточном запасе продолжай текущую сессию. Если счётчик недоступен, оцени объём приблизительно и не выдумывай остаток токенов.",
      "Сначала прочитай .robocop-handoff.md, если он существует, и сверь его с переданным продолжением и текущими файлами. Пиши актуальную сводку после существенных шагов: F-ID, сделанное, проверка, ограничения и первый незавершённый шаг.",
      "При нехватке контекста сохрани .robocop-handoff.md и верни handoff. После произошедшего сжатия сделай это на ближайшей проверяемой паузе. Диспетчер продолжит эту же фичу в той же рабочей копии. Самостоятельно вторую очередь или другого исполнителя не запускай.",
      "При необходимости решения верни question. При необходимости визуальной оценки верни review. Для ready нужны реализация и фактическая проверка критерия. summary — результат и проверка, title — название изменения для Git. media — относительные пути к снимкам и видео."].join("\n\n");
  }
  checkpoint(c,summary,next) {
    const file=safeFile(c.work,".robocop-handoff.md");
    const marker="<!-- gfk-worker-notes -->";
    const previous=fs.existsSync(file)?fs.readFileSync(file,"utf8"):"";
    // Keep the worker's detailed notes without nesting our generated summaries.
    const notes=previous.includes(marker)?previous.slice(previous.indexOf(marker)+marker.length).trim():previous.trim();
    c.handoff=[c.id+" — "+c.title,
      "Рабочая копия: "+c.work,
      "Назначение: "+this.target.remote+"/"+this.target.branch,
      summary,"Следующий шаг: "+next].join("\n\n");
    const text=c.handoff+(notes?"\n\n"+marker+"\n"+notes:"")+"\n";
    const tmp=file+"."+randomUUID()+".tmp";
    try {fs.writeFileSync(tmp,text,{flag:"wx"});fs.renameSync(tmp,file);}
    finally {fs.rmSync(tmp,{force:true});}
    this.save();
  }
  async work(c,deadline) {
    if(!c.work) {
      c.base=targetHead(this.root,this.target);
      c.work=fs.mkdtempSync(path.join(os.tmpdir(),"gfk-feature-"));
      git(this.root,"worktree","add","--detach",c.work,c.base);
    }
    c.state="working";this.save();
    for(let part=0;part<4;part++) {
      c.turns++;this.save();
      let result;
      try {result=await this.worker(c,this.prompt(c),deadline-Date.now(),this.dir);}
      catch(error) {
        if(!/context.{0,30}(window|limit|length)|context_length_exceeded/i.test(error.message)) throw error;
        const file=safeFile(c.work,".robocop-handoff.md");
        const checkpoint=fs.existsSync(file)?fs.readFileSync(file,"utf8").slice(-6000):
          "Контекст исчерпан. Проверь изменения и продолжи по критерию карточки. Файлы:\n"+git(c.work,"status","--short").slice(-3000);
        if(!checkpoint || checkpoint===c.handoff) throw error;
        if(fs.existsSync(file)){c.handoff=checkpoint;this.save();}
        else this.checkpoint(c,checkpoint,"Сверь рабочую копию и продолжи первый незавершённый шаг.");
        continue;
      }
      if(typeof result.summary!=="string" || !result.summary.trim()) throw Error("Пустой отчёт исполнителя.");
      c.summary=result.summary;c.media=(result.media||[]).map(name=>{safeFile(c.work,name);return name;});
      if(result.status==="question"){c.question=result.next||c.summary;c.state="question";this.save();return;}
      if(result.status==="handoff"){
        this.checkpoint(c,result.summary,result.next||"Сверь изменения и продолжи по критерию приёмки.");
        continue;
      }
      if(!["ready","review"].includes(result.status) || !result.files?.length || !result.title?.trim()) throw Error("Нет файлов или результата для приёмки.");
      if(git(c.work,"rev-parse","HEAD")!==c.base) throw Error("Исполнитель изменил историю. Нужна ручная проверка.");
      const files=result.files.filter(name=>name!==".robocop-handoff.md");
      if(!files.length) throw Error("Только сводка контекста, нет изменённых файлов фичи.");
      for(const name of files) {
        const file=safeFile(c.work,name);
        if([this.concept,this.index].some(p=>p.toLowerCase()===name.toLowerCase())) throw Error("Изменение авторского концепта или индекса требует решения в карточке.");
        if(fs.existsSync(file)&&!fs.lstatSync(file).isFile()) throw Error("В коммит допускаются только файлы фичи.");
      }
      git(c.work,"--literal-pathspecs","add","--",...files);
      const staged=git(c.work,"diff","--cached","--no-renames","--name-only","-z").split("\0").filter(Boolean);
      if(staged.some(name=>!files.includes(name))) throw Error("В индексе Git обнаружен файл вне отчёта фичи.");
      if(!git(c.work,"diff","--cached","--name-only")) throw Error("Для фичи нет изменений.");
      if(git(c.work,"diff","--name-only") || git(c.work,"ls-files","--others","--exclude-standard").split("\n").some(s=>s && s!==".robocop-handoff.md"))
        throw Error("В рабочей копии есть изменения вне списка файлов фичи.");
      await command(this.check,c.work,deadline-Date.now());
      if(git(c.work,"diff","--name-only")) throw Error("Проверка изменила отслеживаемые файлы.");
      const indexFile=safeFile(c.work,this.index);
      fs.writeFileSync(indexFile,verifiedIndex(fs.readFileSync(indexFile,"utf8"),c.id));
      git(c.work,"add","--",this.index);
      c.tree=git(c.work,"write-tree");c.state="committing";this.save();
      const title=result.title.trim().split("\n")[0];
      git(c.work,"commit","-m",title.startsWith(c.id)?title:c.id+" "+title);
      c.sha=git(c.work,"rev-parse","HEAD");
      const automatic=this.data.mode==="robocop" && result.status==="ready";
      c.state=automatic?"publishing":"review";this.save();
      if(automatic) await this.publish(c,deadline);
      return;
    }
    throw Error("Достигнут предел четырёх передач контекста за запуск фичи.");
  }
  async publish(c,deadline) {
    const head=targetHead(this.root,this.target);
    if(!c.sha || git(c.work,"rev-parse","HEAD")!==c.sha) throw Error("Рабочая копия расходится с коммитом карточки.");
    if(head!==c.base) {
      try{git(c.work,"rebase","--onto",head,c.base);}
      catch(error){try{git(c.work,"rebase","--abort");}catch{} throw error;}
      c.base=head;c.sha=git(c.work,"rev-parse","HEAD");this.save();
    }
    await command(this.check,c.work,deadline-Date.now());
    if(git(c.work,"status","--porcelain","--untracked-files=no")) throw Error("Проверенная копия изменилась.");
    if(targetHead(this.root,this.target)!==head) throw Error("Ветка изменилась во время проверки.");
    c.state="publishing";this.save();
    git(this.root,"merge","--ff-only",c.sha);
    c.state="push_pending";this.save();
    this.push(c);
  }
  push(c) {
    requireTarget(this.root,this.target);
    if(!git(this.root,"branch","--list",this.target.branch,"--contains",c.sha)) throw Error("В выбранной ветке отсутствует коммит "+c.id);
    const ref="refs/heads/"+this.target.branch;
    try{git(this.root,"push","--",this.target.remote,c.sha+":"+ref);}
    catch(error){
      // A previous push can succeed before the process receives its acknowledgement.
      try{git(this.root,"fetch","--no-tags","--",this.target.remote,ref);git(this.root,"merge-base","--is-ancestor",c.sha,"FETCH_HEAD");}
      catch{throw error;}
    }
    c.pushed=c.sha;c.state="done";c.question="";this.save();
    console.log(c.id+" · "+c.sha.slice(0,8)+" → "+this.target.remote+"/"+this.target.branch);
  }
  async run(id,hours=8,approve=false) {
    if(this.busy) throw Error("Уже выполняется задача.");
    if(!Number.isFinite(hours)||hours<=0||hours>8) throw Error("Допустим запуск до восьми часов.");
    if(this.checkGate) this.checkGate();
    const manual=this.data.mode==="manual";
    if((manual||approve)&&!id) throw Error("Выберите F-ID.");
    let c=id?this.cards.find(x=>x.id===id):this.ready()[0];
    if(!c || (approve?!["review","push_pending"].includes(c.state):!this.ready().includes(c))) throw Error("Задача недоступна.");
    this.busy=true;this.stop=false;
    const deadline=Date.now()+hours*3600000;
    try {
      while(c && !this.stop && Date.now()<deadline) {
        if(this.checkGate) this.checkGate();
        this.activeId=c.id;
        try {
          if(!approve && manual && c.sha) {c.state="review";this.save();break;}
          if(c.state==="push_pending") this.push(c);
          else if(approve || c.sha) await this.publish(c,deadline);
          else await this.work(c,deadline);
        } catch(e) {
          if(c.state!=="push_pending") c.state="question";
          c.question=String(e.message).slice(-2500);this.save();
          // Infrastructure failures should not spend the rest of the night retrying.
          break;
        }
        if(manual || approve || id) break;
        c=this.ready()[0];
      }
    } finally {this.activeId=null;this.busy=false;}
  }
}
module.exports={Board,parseIndex,safeFile,acceptedBuild};
