const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {once}=require("node:events");
const {initialize,read,save,snapshot,serve,handoff}=require("../scripts/project.cjs");
const {verifiedIndex,parseIndex}=require("../scripts/feature-index.cjs");
const templateFolder=path.resolve(__dirname,"../skills/game-creator/assets/templates");
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gfk-project-test-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));initialize(root);return root;
}
test("guided project needs current research, signed concept, three styles, scope, platform and mode",async t=>{
  const root=fixture(t),docs=path.join(root,"docs/game");
  fs.mkdirSync(docs,{recursive:true});
  const write=(name,content)=>fs.writeFileSync(path.join(docs,name),content);
  const state={idea_revision:1,research_revision:1,research_status:"done"};
  const persist=()=>write("state.json",JSON.stringify(state));
  const runs=require("../scripts/stage-run.cjs"),chat=require("../scripts/stage-chat.cjs");
  const uuid=require("node:crypto").randomUUID;
  const launch=id=>runs.start(root,{...read(root),stageId:id,mode:"desktop",requestId:uuid()}).run;
  const {choosePlatform,selectMode}=require("../docs/pipeline/model.js");
  function choose(action){
    const {plan,revision}=read(root);action(plan);save(root,revision,plan);
  }
  write("idea.md","Игрок ищет путь по звёздам.");
  write("research.md","Сравнение навигации. https://example.org/game — проверить, вернётся ли игрок в порт.");
  persist();
  assert.throws(()=>launch("concept"),/Исследование/);
  state.research_decision="keep";persist();
  const concept=launch("concept");
  state.idea_revision=2;persist();
  assert.equal(snapshot(root).stages.research.percent,0);
  await assert.rejects(chat.begin(root,"concept",concept.id,uuid()),/Исследование/);
  state.research_revision=2;persist();
  write("concept.md","Игрок прокладывает курс и возвращается в порт.\nСтатус: черновик");
  assert.throws(()=>launch("board"),/Концепт/);
  write("concept.md","Игрок прокладывает курс и возвращается в порт.\nСтатус: утверждён");
  assert.equal(launch("board").status,"draft");
  state.visual_choice="B";persist();
  write("art-direction.md","A. Акварель\nB. Гравюра");
  assert.throws(()=>launch("scope"),/Визуальное/);
  write("art-direction.md","A. Акварель\nB. Гравюра\nC. Пиксельная графика");
  assert.equal(launch("scope").status,"draft");
  write("feature-index.md","| F-001 | Пройти маршрут | P0 | — | Вернуться в порт | ветер | planned |");
  assert.throws(()=>choose(p=>choosePlatform(p,"Roblox","Компьютер","3D")),/Объём MVP/);
  state.mvp_choice="A";persist();
  choose(p=>choosePlatform(p,"Roblox","Компьютер","3D"));
  assert.throws(()=>launch("build"),/Режим работы/);
  choose(p=>selectMode(p,"manual"));
  assert.equal(launch("build").status,"draft");
  choose(p=>choosePlatform(p,"Unity","Компьютер","3D"));
  assert.throws(()=>launch("build"),/Режим работы/);
});
test("empty templates do not count as work, custom indexed project shows only verified in-scope features",t=>{
  const root=fixture(t), docs=path.join(root,"docs/game");
  fs.cpSync(templateFolder,docs,{recursive:true});
  let data=snapshot(root);assert.ok(Object.values(data.stages).every(n=>n.percent===0));
  fs.appendFileSync(path.join(docs,"idea.md"),"Игрок ведёт корабль к маяку.");
  const ix="| ID | Название | Приоритет | Статус | Зависимости | Критерий готовности | Проверка |\r\n"+
    "| F-01 | Первая | MVP | verified | — | Работает | Play |\r\n| F-02 | Новая | MVP | in_progress | F-01 | Тест | Edit |\r\n"+
    "| F-03 | Позже | P1 | deferred | F-02 | Тест | — |\r\n";
  fs.writeFileSync(path.join(root,"docs/feature-index.md"),ix);
  data=snapshot(root);assert.equal(data.stages.idea.percent,100);assert.equal(data.stages.build.percent,50);
  assert.equal(data.features.length,2);assert.equal(data.doneFeatures,1);
  assert.equal(verifiedIndex(ix,"F-02"),ix.replace("in_progress","verified"));
  assert.equal(parseIndex(ix)[1].deps[0],"F-01");
  assert.match(handoff(root,data),/F-02/);
});
test("project edits survive restart; stale writers and foreign paths cannot replace evidence",async t=>{
  const root=fixture(t), initial=read(root);
  initial.plan.nodes[0].report="Моя идея";
  const rev=save(root,initial.revision,initial.plan);assert.equal(rev,read(root).revision);
  assert.throws(()=>save(root,initial.revision,initial.plan),/другой сессии/);
  fs.writeFileSync(path.join(root,"idea.md"),"Моя идея");
  const server=serve(root);await once(server,"listening");
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url="http://127.0.0.1:"+server.address().port;
  const data=await (await fetch(url+"/api/project")).json();assert.equal(data.stages.idea.percent,100);
  data.plan.nodes[0].report="Из карточки";
  const put={method:"PUT",headers:{"Content-Type":"application/json",Origin:url},body:JSON.stringify({revision:data.revision,plan:data.plan})};
  assert.equal((await fetch(url+"/api/project",put)).status,200);
  assert.equal((await fetch(url+"/api/project",put)).status,409);
  assert.equal(read(root).plan.nodes[0].report,"Из карточки");
  assert.equal(await (await fetch(url+"/api/document?path=idea.md")).text(),"Моя идея");
  assert.equal((await fetch(url+"/api/document?path=../secret.md")).status,404);
  assert.equal((await fetch(url+"/api/project",{method:"PUT",headers:{"Content-Type":"application/json",Origin:"https://other.invalid"},body:"{}"})).status,403);
  assert.match(await (await fetch(url+"/api/handoff")).text(),/Продолжение работы/);
});

test("launch saves only the requested step, deduplicates clicks and publishes a scoped result",async t=>{
  const root=fixture(t),data=read(root);
  const node=data.plan.nodes.find(n=>n.id==="research");
  node.remaining="Сравнить две игры";
  let starts=0;
  const server=serve(root,{launch:()=>({pid:process.pid,begin(){starts++;}})});
  await once(server,"listening");t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url="http://127.0.0.1:"+server.address().port;
  const request={...data,stageId:node.id,requestId:require("node:crypto").randomUUID()};
  const post=(body,origin=url)=>fetch(url+"/api/stage-run",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await post(request,"https://foreign.invalid")).status,403);
  assert.equal((await post(request)).status,409);
  fs.writeFileSync(path.join(root,"idea.md"),"Идея текущей игры.");
  assert.equal((await post(request)).status,202);assert.equal((await post(request)).status,202);
  assert.equal(starts,1);assert.equal(snapshot(root).stages.research.status,"active");
  const thread=require("node:crypto").randomUUID();let opened;
  const {perform}=require("../scripts/stage-run.cjs");
  await perform(root,node.id,request.requestId,async(dir,job,started)=>{
    assert.equal(dir,root);assert.match(job.prompt,/Сравнить две игры/);assert.match(job.prompt,/idea\.md/);
    started(thread);
    assert.equal(opened,undefined);
    assert.equal(snapshot(root).stageRuns.research.threadId,thread);
    fs.writeFileSync(path.join(root,"research.md"),"Факты и выводы.");
    return {status:"partial",progress:60,summary:"Источники собраны.",remaining:"Проверить гипотезу",documents:["research.md"]};
  },id=>{assert.equal(snapshot(root).stageRuns.research.status,"partial");opened=id;});
  assert.equal(opened,thread);const after=snapshot(root);assert.equal(after.stageRuns.research.threadId,thread);
  assert.equal(after.stages.research.percent,60);assert.equal(after.stages.concept.status,"planned");
  assert.equal(after.plan.nodes.find(n=>n.id===node.id).remaining,"Проверить гипотезу");
});

test("native draft runs in its sending chat and returns documents to the same card",async t=>{
  const root=fixture(t),data=read(root);
  const runs=require("../scripts/stage-run.cjs"),chat=require("../scripts/stage-chat.cjs");
  const id=require("node:crypto").randomUUID(),thread=require("node:crypto").randomUUID();
  const request={...data,mode:"desktop",stageId:"idea",requestId:id};
  const draft=runs.start(root,request,()=>assert.fail("A native draft must not start a worker")).run;
  assert.equal(draft.status,"draft");
  const url=new URL(draft.draftUrl);
  assert.equal(url.protocol,"codex:");assert.equal(url.searchParams.get("path"),root);
  assert.ok(url.searchParams.get("prompt").includes(id));
  assert.equal(runs.start(root,{...request,revision:read(root).revision,requestId:require("node:crypto").randomUUID()}).run.id,id);
  assert.equal(snapshot(root).stages.idea.status,"planned");
  assert.match(await chat.begin(root,"idea",id,thread),/кликабельные/);
  assert.equal(snapshot(root).stageRuns.idea.threadId,thread);
  await assert.rejects(chat.begin(root,"idea",id,require("node:crypto").randomUUID()),/запущен/);
  fs.writeFileSync(path.join(root,"idea.md"),"Повар жарит стейк.");
  fs.writeFileSync(path.join(root,runs.directory,id+".result.json"),JSON.stringify({
    status:"done",progress:100,summary:"Идея записана.",documents:["idea.md"],remaining:"Исследование"}));
  await chat.finish(root,"idea",id,thread);
  assert.equal(await chat.finish(root,"idea",id,thread),"Идея записана.");
  assert.deepEqual(snapshot(root).stageRuns.idea.documents,["idea.md"]);
  const retry=runs.start(root,{...read(root),mode:"desktop",stageId:"idea",requestId:require("node:crypto").randomUUID()}).run;
  await chat.begin(root,"idea",retry.id,thread);
  await chat.detach(root,"idea",retry.id);
  await assert.rejects(chat.finish(root,"idea",retry.id,thread),/закрыта/);
});
test("audit can credit earlier evidence in a differently named file without marking a saved task as progress",async t=>{
  const root=fixture(t),data=read(root),id=require("node:crypto").randomUUID();
  data.plan.nodes.find(n=>n.id==="research").remaining="Сравнить аналоги";
  fs.writeFileSync(path.join(root,"design-notes.md"),"Гипотеза: не менее половины игроков возвращаются в раунд.");
  const runs=require("../scripts/stage-run.cjs");
  save(root,data.revision,data.plan);
  assert.equal(snapshot(root).stages.research.percent,0);
  const current=read(root);
  runs.start(root,{...current,stageId:"@audit",requestId:id},()=>({pid:process.pid,begin(){}}));
  const stages=current.plan.nodes.map(n=>({id:n.id,percent:n.id==="research"?33:0,remaining:"Сравнить аналоги и указать источники.",
    evidence:n.id==="research"?[{path:"design-notes.md",fact:"Указан порог повторного раунда."}]:[]}));
  const choice=stages.find(s=>s.id==="work-mode");
  choice.evidence=[{path:".game-factory/private.json",fact:"Режим ещё не выбран."}];
  const report={summary:"Этапы проверены.",stages};
  await runs.perform(root,"@audit",id,async()=>report);
  assert.equal(snapshot(root).stageRuns["@audit"].status,"failed");
  choice.evidence[0].path=".game-factory/pipeline.json";
  runs.recoverAudit(root,id,report);
  assert.equal(snapshot(root).stageRuns["@audit"].status,"done");
  assert.throws(()=>runs.recoverAudit(root,id,report),/неудачного/);
  let result=snapshot(root);assert.equal(result.stages.research.percent,33);
  assert.equal(result.stages.research.evidence[0].path,"design-notes.md");
  assert.equal(read(root).plan.nodes.find(n=>n.id==="research").remaining,"Сравнить аналоги");
  fs.unlinkSync(path.join(root,"design-notes.md"));result=snapshot(root);assert.equal(result.stages.research.percent,0);
});

test("native context handoff keeps the run, accepts a retry and prevents the old chat from finishing",async t=>{
  const root=fixture(t),runs=require("../scripts/stage-run.cjs"),chat=require("../scripts/stage-chat.cjs");
  const uuid=()=>require("node:crypto").randomUUID();
  const id=uuid(),source=uuid(),target=uuid();
  runs.start(root,{...read(root),mode:"desktop",stageId:"idea",requestId:id});
  await chat.begin(root,"idea",id,source);
  await assert.rejects(chat.handoff(root,"idea",id,source,target),/ENOENT/);
  assert.equal(runs.load(root,"idea").threadId,source);
  fs.writeFileSync(path.join(root,"checkpoint.md"),"F-001 — управление. Сделано: ввод. Проверка: PASS. Дальше: перезапуск.");
  await chat.handoff(root,"idea",id,source,target,"checkpoint.md");
  await chat.handoff(root,"idea",id,source,target,"checkpoint.md");
  assert.equal(runs.load(root,"idea").handoffs.length,1);
  assert.equal(runs.load(root,"idea").id,id);
  await assert.rejects(chat.finish(root,"idea",id,source),/другому/);
  await assert.rejects(chat.begin(root,"idea",id,source),/запущен/);
  await assert.rejects(chat.handoff(root,"idea",id,source,uuid(),"checkpoint.md"),/Владелец/);
  assert.match(await chat.begin(root,"idea",id,target),new RegExp("finish idea "+id+" "+target));
  fs.writeFileSync(path.join(root,"idea.md"),"Повар готовит стейк.");
  fs.writeFileSync(path.join(root,runs.directory,id+".result.json"),JSON.stringify({
    status:"done",progress:100,summary:"Идея записана.",documents:["idea.md"],remaining:"Исследовать аналоги"}));
  await chat.finish(root,"idea",id,target);
  assert.equal(runs.load(root,"idea").status,"done");
  assert.equal(snapshot(root).stages.idea.percent,100);
});
