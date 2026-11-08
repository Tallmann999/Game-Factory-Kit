const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {main} = require("../scripts/run-pipeline.cjs");
const {initialPlan,briefing,choosePlatform,extraSkills,checkDiagram} = require("../docs/pipeline/model.js");
const {composition} = require("../docs/pipeline/skills.js");

test("stage tables cover the shipped manifest and follow the assigned lead",()=>{
  const plan=initialPlan();
  const names=new Set(plan.nodes.flatMap(node=>composition(node).map(skill=>skill.name)));
  assert.deepEqual(names,new Set(require("../kit.json").skills.map(skill=>skill.name)));
  const build=plan.nodes.find(node=>node.id==="build");
  build.agent="unity-mcp-orchestrator";
  assert.deepEqual(composition(build).filter(skill=>skill.lead).map(skill=>skill.name),[build.agent]);
  assert.equal(composition(build).filter(skill=>skill.name===build.agent).length,1);
});

test("disconnected and cyclic plans cannot be dispatched",()=>{
  const plan=initialPlan();
  const first=plan.edges.shift();
  assert.throws(()=>briefing(plan),/связи/);
  plan.edges.push(first,{...first,id:"loop",from:"scope",to:"concept"});
  assert.throws(()=>briefing(plan),/цикл/);
});

test("platform choice routes build and QA without leaking skills between engines",()=>{
  const p=initialPlan(),build=p.nodes.find(n=>n.id==="build"),qa=p.nodes.find(n=>n.id==="qa");
  assert.throws(()=>briefing(p),/На какой платформе/);
  build.skills=["phaser-animations","game-marketing"];
  choosePlatform(p,"HTML / Web","Телефон / планшет","2D");
  assert.ok(extraSkills(build,p).includes("phaser-scenes"));
  assert.ok(extraSkills(qa,p).includes("playwright"));
  assert.ok(extraSkills(build,p).includes("game-mobile"));
  build.status="done"; build.report="Первый раунд прошёл";
  choosePlatform(p,"Unity","Компьютер","3D");
  assert.equal(build.agent,"unity-mcp-orchestrator");
  assert.equal(build.status,"planned");
  assert.ok(extraSkills(qa,p).includes("unity-mcp-orchestrator"));
  assert.ok(extraSkills(build,p).includes("blender-core"));
  assert.ok(extraSkills(build,p).includes("game-marketing"));
  assert.doesNotMatch(briefing(p),/Подключить скилл: (phaser-|playwright|game-mobile)/);
  const restored=JSON.parse(JSON.stringify(p));
  checkDiagram(restored);assert.equal(briefing(restored),briefing(p));
  choosePlatform(p,"Roblox","Компьютер и мобильные","3D");
  assert.ok(extraSkills(build,p).includes("game-roblox-ui"));
  assert.ok(extraSkills(qa,p).includes("game-roblox-ui"));
  assert.ok(extraSkills(build,p).includes("scenario-roblox-expert"));
  assert.ok(extraSkills(qa,p).includes("scenario-roblox-performance"));
  build.skills.push("game-roblox-ui","scenario-roblox-expert","scenario-roblox-performance");
  choosePlatform(p,"HTML / Web","Компьютер","2D");
  assert.ok(!extraSkills(build,p).includes("game-roblox-ui"));
  assert.ok(!extraSkills(build,p).some(name=>name.startsWith("scenario-roblox-")));
});

test("a stage waits for consent and passes its accepted result to the next agent", async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gfk-run-"));
  const file=path.join(dir,"plan.json");
  t.after(()=>{fs.rmSync(file,{force:true});fs.rmdirSync(dir);});
  const plan=initialPlan();
  plan.nodes[0].policy="confirm";
  plan.nodes[0].skills=["game-design"];
  choosePlatform(plan,"Unity","Компьютер","2D");
  assert.match(briefing(plan),/Подключить скилл: game-design/);
  fs.writeFileSync(file,JSON.stringify(plan));
  const args=[file,"--project",dir];
  const read=()=>JSON.parse(fs.readFileSync(file,"utf8"));
  const prompts=[];
  const services={ask:async()=>"нет",launch:(cwd,prompt)=>{
    assert.equal(cwd,fs.realpathSync(dir)); prompts.push(prompt);return {status:0};
  }};
  await main(args,services);
  assert.equal(prompts.length,0);
  assert.equal(read().nodes[0].status,"planned");
  await assert.rejects(main([...args,"--stage","research"],services),/входы/);
  const answers=["да","1","Проверено: docs/game/idea.md"];
  services.ask=async()=>answers.shift();
  await main(args,services);
  assert.equal(read().nodes[0].status,"done");
  assert.match(prompts[0],/game-creator/);
  assert.match(prompts[0],/Подключить скилл: game-design/);
  services.ask=async()=>"";
  await main(args,services);
  assert.match(prompts[1],/game-market-research/);
  assert.match(prompts[1],/Проверено: docs\/game\/idea.md/);
  assert.equal(read().nodes[1].status,"active");
  assert.ok(!fs.existsSync(file+".lock"));
});

test("CLI asks for a platform in a legacy plan and uses it for the following build",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gfk-platform-"));
  const file=path.join(dir,"plan.json");
  t.after(()=>{fs.rmSync(file,{force:true});fs.rmdirSync(dir);});
  const plan=initialPlan();
  plan.nodes=plan.nodes.filter(n=>n.id!=="work-mode");
  plan.edges=plan.edges.filter(e=>e.to!=="work-mode");
  for(const edge of plan.edges) if(edge.from==="work-mode") edge.from="platform";
  delete plan.modeGateVersion;
  for (const node of plan.nodes) {
    if (["idea","research","concept","scope","board"].includes(node.id)) node.status="done";
  }
  const legacy=JSON.stringify(plan);
  fs.writeFileSync(file,legacy);
  const args=[file,"--project",dir];
  let questions=[], answers=["1",""], prompts=[];
  const services={ask:async q=>{questions.push(q);return answers.shift();},
    launch:(cwd,prompt)=>{prompts.push(prompt);return {status:0};}};
  await main(args,services);
  assert.equal(fs.readFileSync(file,"utf8"),legacy);
  assert.match(questions[0],/На какой платформе/);
  answers=["1","2","1"];
  await main(args,services);
  assert.equal(prompts.length,0);
  assert.equal(JSON.parse(fs.readFileSync(file)).nodes.find(n=>n.id==="platform").status,"done");
  answers=[""];
  await main(args,services);
  assert.match(prompts[0],/HTML \/ Web · Телефон \/ планшет · 2D/);
  assert.match(prompts[0],/Подключить скилл: phaser-scenes/);
  assert.match(prompts[0],/Подключить скилл: game-mobile/);
});
