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
