const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const {Board,parseIndex,acceptedBuild}=require("../scripts/robocop-board.cjs");
const {action}=require("../scripts/robocop.cjs");
const {initialPlan,choosePlatform,selectMode}=require("../docs/pipeline/model.js");
const git=(dir,...args)=>execFileSync("git",["-C",dir,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const row=(id,deps="—")=>"| "+id+" | Фича "+id+" | P0 | "+deps+" | Работает | низкий | planned |";
function fixture(t,mode,worker,check="process.exit(0)",branch="main"){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"gfk-board-test-"));
  git(root,"init","-b",branch);git(root,"config","user.name","GFK test");git(root,"config","user.email","test@example.invalid");
  const docs=path.join(root,"docs/game");fs.mkdirSync(docs,{recursive:true});
  fs.writeFileSync(path.join(docs,"feature-index.md"),[row("F-1"),row("F-2","F-1"),row("F-3")].join("\n"));
  fs.writeFileSync(path.join(docs,"concept.md"),"Игра автора.");
  git(root,"add",".");git(root,"commit","-m","initial");
  const plan=initialPlan();choosePlatform(plan,"Unity","Компьютер","2D");selectMode(plan,mode);
  const remote=path.join(root,".git","test-remote.git");git(root,"init","--bare",remote);git(root,"remote","add","origin",remote);
  plan.gitTarget={remote:"origin",branch};
  const b=new Board(root,plan,[process.execPath,"-e",check],{worker});
  t.after(()=>{
    b.close();
    for(const c of b.cards) if(c.work && path.dirname(c.work)===os.tmpdir() && path.basename(c.work).startsWith("gfk-feature-"))
      git(root,"worktree","remove","--force",c.work);
    if(path.dirname(root)===os.tmpdir() && path.basename(root).startsWith("gfk-board-test-"))fs.rmSync(root,{recursive:true,force:true});
  });
  return b;
}
function finish(c){
  fs.writeFileSync(path.join(c.work,c.id+".txt"),"ok");
  return {status:"ready",title:"Добавлена "+c.id,summary:"Проверено",files:[c.id+".txt"],media:[]};
}
test("night queue hands off, skips a question, persists decisions and commits per feature",async t=>{
  const b=fixture(t,"robocop",(c,prompt)=>{
    if(c.id==="F-1" && c.turns===1)return {status:"handoff",summary:"Шаг 1",next:"Продолжи с шага 2"};
    if(c.id==="F-1" && c.turns===2){assert.match(prompt,/Продолжи с шага 2/);return {status:"question",summary:"Нужен выбор",next:"Сколько очков?"};}
    if(c.id==="F-1")assert.match(prompt,/Три очка/);
    return finish(c);
  },"const fs=require('fs');if(!fs.readdirSync('.').some(x=>x.endsWith('.txt')))process.exit(1)");
  await b.run();
  assert.deepEqual(b.cards.map(c=>c.state),["question","ready","done"]);
  action(b,{type:"defer",id:"F-1"});assert.equal(b.cards[0].state,"deferred");
  action(b,{type:"answer",id:"F-1",value:"Три очка"});await b.run();
  assert.deepEqual(b.cards.map(c=>c.state),["done","done","done"]);
  assert.equal(git(b.root,"rev-list","--count","main"),"4");
  assert.equal(git(b.root,"rev-parse","HEAD"),git(b.root,"rev-parse","refs/remotes/origin/main"));
  assert.match(git(b.root,"show","HEAD:docs/game/feature-index.md"),/verified/);
  assert.match(acceptedBuild(b.root,b.plan),/F-1 [a-f0-9]{8}/);
  assert.equal(JSON.parse(fs.readFileSync(b.file)).cards[0].decisions.length,1);
});
test("manual review keeps main unchanged, accepts feedback, then publishes exactly one commit",async t=>{
  const b=fixture(t,"manual",c=>finish(c));await b.run("F-1");assert.equal(b.cards[0].state,"review");
  assert.equal(git(b.root,"rev-list","--count","main"),"1");
  action(b,{type:"answer",id:"F-1",value:"Уточни результат"});await b.run("F-1");
  await b.run("F-1",8,true);assert.equal(b.cards[0].state,"done");
  assert.equal(git(b.root,"rev-list","--count","main"),"2");
});
test("failed acceptance cannot publish or start a dependent feature",async t=>{
  const b=fixture(t,"robocop",finish,"process.exit(3)");await b.run();
  assert.equal(b.cards[0].state,"question");assert.ok(!b.ready().includes(b.cards[1]));
  assert.equal(git(b.root,"rev-list","--count","main"),"1");
});
test("unknown and cyclic dependencies are rejected",()=>{
  assert.throws(()=>parseIndex(row("F-1","F-2")),/зависимость/);
  assert.throws(()=>parseIndex(row("F-1","F-1")),/зависимость/);
});

test("push failure keeps SHA and blocks queue; retry publishes to the chosen non-main branch",async t=>{
  const b=fixture(t,"robocop",finish,"process.exit(0)","release/demo");
  const url=git(b.root,"remote","get-url","origin");
  git(b.root,"remote","set-url","origin",path.join(b.root,"missing-remote"));
  await b.run();
  const card=b.cards[0],sha=card.sha;
  assert.equal(card.state,"push_pending");assert.deepEqual(b.ready(),[]);
  assert.equal(git(b.root,"rev-parse","HEAD"),sha);
  git(b.root,"remote","set-url","origin",url);
  await b.run(card.id,8,true);
  assert.equal(card.pushed,sha);assert.equal(card.state,"done");
  assert.equal(git(url,"rev-parse","refs/heads/release/demo"),sha);
  assert.equal(git(b.root,"rev-list","--count","HEAD"),"2");
  assert.throws(()=>new Board(b.root,{...b.plan,gitTarget:undefined},["node","--version"]),/ветку/);
});
