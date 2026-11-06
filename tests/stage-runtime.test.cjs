const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {randomUUID}=require("node:crypto");
const project=require("../scripts/project.cjs"),runs=require("../scripts/stage-run.cjs");
const runtime=require("../scripts/codex-runtime.cjs");
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),"gfk-runtime-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));project.initialize(root);return root;}
function request(root){return {...project.read(root),stageId:"idea",requestId:randomUUID()};}
const launch=()=>({pid:process.pid,identity:{pid:999999,started:"test"},begin(){}});
test("project paths with slash separators resolve without looping",t=>{
  const root=fixture(t),{safeFile}=require("../scripts/robocop-board.cjs");
  assert.equal(safeFile(root.replace(/\\/g,"/"),"docs/idea.md"),path.join(root,"docs/idea.md"));
});

test("preflight blocks isolated users and records selected CLI without claiming a network test",()=>{
  const calls=[];
  const args={env:{CODEX_HOME:os.tmpdir()},user:"CodexSandboxOffline",command:()=>["configured-codex"],run:(bin,argv)=>{calls.push([bin,argv]);return {status:0,stdout:"codex 0.test"};}};
  const blocked=runtime.preflight(args);
  assert.equal(blocked.available,false);assert.equal(blocked.version,"codex 0.test");assert.equal(calls.length,1);
  assert.match(blocked.reasons[0],/изолированной/);
  const available=runtime.preflight({...args,user:"regular-user"});
  assert.equal(available.available,true);assert.equal(available.auth,"вход подтверждён");
  assert.deepEqual(calls.at(-1)[1],["login","status"]);
  assert.equal(runtime.preflight({...args,user:"regular-user",env:{...args.env,CODEX_SANDBOX_NETWORK_DISABLED:"1"}}).available,false);
});
test("cancel keeps partial files, exposes the thread early and rejects stale completion",async t=>{
  const root=fixture(t),req=request(root);runs.start(root,req,launch);
  let finish,ready;const started=new Promise(r=>ready=r);
  const thread=randomUUID(),stopped=[];
  const working=runs.perform(root,"idea",req.requestId,async(dir,job,onThread,onProgress,onEvent,onCli)=>{
    onCli({pid:999998,started:"test-cli"});onThread(thread);
    onEvent({type:"stderr",message:"Authorization: Bearer private-token api_key=hidden-value"});
    onProgress("Читаю документы");
    fs.writeFileSync(path.join(root,"partial.md"),"Saved before cancellation");
    ready();return await new Promise(resolve=>finish=resolve);
  },()=>assert.fail("Cancelled work must not open a result window"));
  await started;
  assert.equal(runs.publicJob(runs.load(root,"idea")).threadId,thread);
  assert.match(runs.logText(root,"idea",req.requestId),/redacted/);
  assert.doesNotMatch(runs.logText(root,"idea",req.requestId),/private-token|hidden-value/);
  await assert.rejects(runs.cancel(root,"idea",randomUUID(),"stop",p=>stopped.push(p.pid)),/другой/);
  const cancelled=await runs.cancel(root,"idea",req.requestId,"Stopped",p=>stopped.push(p.pid));
  assert.equal(cancelled.status,"cancelled");assert.deepEqual(stopped,[999998,999999]);
  assert.equal(fs.readFileSync(path.join(root,"partial.md"),"utf8"),"Saved before cancellation");
  const next=request(root);next.mode="desktop";
  runs.start(root,next);
  finish({status:"done",progress:100,summary:"late result",documents:["partial.md"],remaining:""});
  await working;
  assert.equal(runs.load(root,"idea").id,next.requestId);
  assert.equal(project.read(root).plan.nodes[0].report,undefined);
  assert.equal(runs.load(root,"idea").status,"draft");
});
test("stalled state does not permit a duplicate and a failed stop keeps the gate closed",async t=>{
  const root=fixture(t),req=request(root);runs.start(root,req,launch);
  const file=runs.jobFile(root,"idea"),job=runs.load(root,"idea");
  job.lastEventAt=new Date(Date.now()-500000).toISOString();job.status="running";runs.store(file,job);
  assert.equal(runs.load(root,"idea").status,"stalled");
  assert.throws(()=>runs.start(root,request(root),launch),/уже запущен/);
  const failed=await runs.cancel(root,"idea",req.requestId,"stop",()=>{throw Error("identity changed");});
  assert.equal(failed.status,"cancelling");assert.match(failed.message,/identity changed/);
  assert.throws(()=>runs.start(root,{...request(root),mode:"desktop"}),/уже запущен/);
  const done=await runs.cancel(root,"idea",req.requestId,"stop",()=>{});
  assert.equal(done.status,"cancelled");
});
test("window-opening errors cannot turn a completed task into a failure",async t=>{
  const root=fixture(t),req=request(root);runs.start(root,req,launch);
  await runs.perform(root,"idea",req.requestId,async(dir,job,onThread)=>{
    onThread(randomUUID());fs.writeFileSync(path.join(root,"idea.md"),"A game idea");
    return {status:"done",progress:100,summary:"Saved",documents:["idea.md"],remaining:"Research"};
  },()=>{throw Error("No URL handler");});
  const job=runs.load(root,"idea");assert.equal(job.status,"done");assert.equal(job.opening.status,"failed");
  assert.equal(project.snapshot(root).stages.idea.percent,100);
});
