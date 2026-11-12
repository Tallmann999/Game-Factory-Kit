"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {parseIndex,safeFile} = require("./robocop-board.cjs");
const {boardDirectory,targets} = require("./project-git.cjs");
const {platformLabel} = require("../docs/pipeline/model.js");
const kit=path.resolve(__dirname,"..");
const omitted=new Set(["node_modules","vendor","Library","Temp","obj","bin","Packages","Logs","logs","coverage","__pycache__"]);
const docTypes=/\.(md|txt|csv|json|png|webp|jpe?g|xml|cs|gd|ts|js|lua|luau|unity|tscn|godot|html|asset|prefab|csproj|ya?ml|uproject)$/i;
const names={
  idea:/^(idea|pitch|идея)\.md$/i, research:/^(research|market-research|исследование)\.md$/i,
  concept:/^(concept|game[_-]concept|project-concept|gdd|game-design|концепт)\.md$/i, scope:/^(feature-index|feature_index|features)\.md$/i,
  platform:/^technical-plan\.md$/i, board:/^(reference-board|art-direction|style-guide)\.md$/i,
  build:/^(technical-plan|feature-index)\.md$/i, qa:/^(qa|playtest|test-report|test-plan)\.md$/i,
  finish:/^(release|release-notes|handover)\.md$/i
};
function docPath(root,relative) {
  if(typeof relative!=="string" || !docTypes.test(relative) || (relative!==".game-factory/pipeline.json" && relative.split("/").some(part=>part.startsWith(".")))) throw Error("Укажите доступный документ внутри папки игры: "+String(relative).slice(0,200));
  const file=safeFile(root,relative);
  if(file===kit || file.startsWith(kit+path.sep) || !fs.statSync(file).isFile()) throw Error("Документ недоступен.");
  return file;
}
function inventory(root) {
  const files=[],pending=[""];let visited=0;
  while(pending.length && visited<40000) {
    const rel=pending.pop();
    for(const entry of fs.readdirSync(path.join(root,rel),{withFileTypes:true})) {
      if(++visited>40000)break;
      if(entry.name.startsWith(".") || omitted.has(entry.name) || entry.isSymbolicLink())continue;
      const name=path.posix.join(rel,entry.name);
      if(entry.isDirectory()) {
        const folder=path.join(root,name);
        if(folder!==kit && !(fs.existsSync(path.join(folder,"kit.json")) && fs.existsSync(path.join(folder,"scripts","kit.py"))))pending.push(name);
      } else if(entry.isFile()) files.push(name);
    }
  }
  return {files,truncated:visited>=40000};
}
function readText(file) {
  if(!fs.existsSync(file) || fs.statSync(file).size>2*1024*1024)return "";
  return fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"");
}
// Ignore headings, empty fields and unchanged text shipped in the kit's templates.
function filled(text,template) {
  const lines=new Set(template.split(/\r?\n/).map(s=>s.trim()));
  return text.split(/\r?\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith("#") && !lines.has(s) && !/^[-\s|:]+$/.test(s)).join("\n");
}
const reviewPath=".game-factory/project-audit.json";
function saveReview(root,plan,result) {
  if(typeof result?.summary!=="string" || !Array.isArray(result.stages) || result.stages.length!==plan.nodes.length)throw Error("Нужна оценка каждого этапа проекта.");
  const ids=new Set(plan.nodes.map(n=>n.id));
  const stages=result.stages.map(s=>{
    if(!ids.delete(s.id) || !Number.isInteger(s.percent) || s.percent<0 || s.percent>100 || typeof s.remaining!=="string" ||
      !Array.isArray(s.evidence) || s.evidence.length>50 || (s.percent>0 && !s.evidence.length))throw Error("Оценка этапа требует подтверждения: "+s.id);
    const evidence=s.evidence.map(({path:name,fact})=>{
      if(typeof fact!=="string" || !fact.trim() || fact.length>3000)throw Error("Укажите факт из документа.");
      const stat=fs.statSync(docPath(root,name));
      return {path:name,fact,size:stat.size,mtime:stat.mtimeMs};
    });
    return {id:s.id,percent:s.percent,remaining:s.remaining.slice(0,3000),evidence};
  });
  const file=safeFile(root,reviewPath),tmp=file+"."+require("node:crypto").randomUUID()+".tmp";
  try{fs.writeFileSync(tmp,JSON.stringify({date:new Date().toISOString(),summary:result.summary.slice(0,3000),stages},null,2));fs.renameSync(tmp,file);}
  finally{fs.rmSync(tmp,{force:true});}
}
function audit(root,plan) {
  const {files,truncated}=inventory(root), stages={},warnings=[];
  if(truncated) warnings.push("Осмотрены первые 40 000 записей. Остальные документы можно привязать в карточках.");
  const choices=targets(root);
  let reviews=[],lastAudit=null;
  const review=safeFile(root,reviewPath);
  if(fs.existsSync(review))try{
    const saved=JSON.parse(fs.readFileSync(review,"utf8"));
    if(!Array.isArray(saved.stages))throw Error("Отсутствуют этапы");
    reviews=saved.stages;lastAudit={date:saved.date,summary:saved.summary};
  }catch{warnings.push("Не удалось прочитать выводы аудита проекта.");}
  function currentEvidence(e){
    try{const stat=fs.statSync(docPath(root,e.path));return stat.size===e.size && stat.mtimeMs===e.mtime;}catch{return false;}
  }
  const verified=new Map(reviews.filter(s=>s.evidence.every(currentEvidence)).map(s=>[s.id,s]));
  const filesByStage={};
  const contents={};
  const meaningful={};
  for(const n of plan.nodes) {
    const found=files.filter(f=>names[n.id]?.test(path.posix.basename(f)));
    const linked=[...new Set([...(n.documents||[]),...found,...(verified.get(n.id)?.evidence||[]).map(e=>e.path)])];
    filesByStage[n.id]=[]; const parts=[];
    for(const f of linked.slice(0,100)) {
      try {
        const file=docPath(root,f);filesByStage[n.id].push(f);
        if(!/\.(txt|md|csv)$/i.test(f))continue;
        const text=contents[f]??=readText(file);
        const template=readText(path.join(kit,"skills/game-creator/assets/templates",path.basename(f)));
        parts.push(filled(text,template));
      } catch {warnings.push("Недоступен документ: "+f);}
    }
    meaningful[n.id]=parts.filter(Boolean).join("\n");
  }
  let state={};
  if(files.includes("docs/game/state.json"))try{state=JSON.parse(readText(docPath(root,"docs/game/state.json")));}catch{warnings.push("Проверьте docs/game/state.json.");}
  let cards=[],board=[],executionNote="";
  const index=filesByStage.scope?.find(f=>(contents[f]||"").match(/^\s*\|\s*F-\d+/im));
  if(index)try { cards=parseIndex(contents[index],{inspect:true}).filter(c=>c.priority!=="later" && c.state!=="cut"); }
  catch(e){warnings.push(e.message);}
  if(cards.length)try{parseIndex(contents[index]);}catch(e){executionNote=e.message;}
  if(plan.gitTarget && choices.current===plan.gitTarget.branch) {
    try {
      const file=path.join(boardDirectory(root,plan.gitTarget),"board.json");
      if(fs.existsSync(file)){
        const saved=JSON.parse(readText(file));
        if(saved.platform===platformLabel(plan)) board=saved.cards;
      }
    } catch {warnings.push("Не удалось прочитать доску фич.");}
  }
  const features=cards.map(c=>{
    const task=board.find(b=>b.id===c.id);
    return {id:c.id,title:c.title,done:task?task.state==="done":c.state==="done",
      state:task?.state||c.indexStatus};
  });
  const count=features.filter(f=>f.done).length;
  const code=files.some(f=>/(^|\/)(index\.html|project\.godot|[^/]+\.unity|[^/]+\.project\.json|[^/]+\.uproject)$/i.test(f));
  const qaRows=(meaningful.qa||"").split("\n").filter(s=>s.startsWith("|") && /\|\s*(PASS|FAIL|NOT_RUN)\s*\|/i.test(s));
  const checks={
    idea:[[!!meaningful.idea,"Записать исходную идею и действие игрока."]],
    research:[[!!meaningful.research,"Описать результаты исследования."],[/https?:\/\//i.test(meaningful.research||""),"Приложить источники аналогов."],
      [["done","complete","completed"].includes(state.research_status),"Зафиксировать вывод и завершение исследования."]],
    concept:[[!!meaningful.concept,"Описать механики и пиллары."],[/^(?:Статус|Status):\s*(утвержд[её]н|approved)\b/im.test(meaningful.concept||"") || /Статус:\s*утвержд[её]н/im.test(meaningful.concept||""),"Получить подтверждение автора и записать его в концепт."]],
    scope:[[cards.length>0,"Заполнить Feature Index с F-ID, зависимостями и критериями."]],
    platform:[[!!plan.platform,"Зафиксировать движок, устройство и 2D/3D."]],
    "work-mode":[[!!plan.workMode,"Выбрать ручной режим или Робокопа."]],
    board:[[!!meaningful.board,"Сохранить визуальное направление или зафиксировать согласованный пропуск."]],
    build:features.length?features.map(f=>[f.done,f.id+" · "+f.title]):[[code,"Добавить точку входа или сцену игры."],[false,"Привязать Feature Index и проверить реализацию."]],
    qa:[[qaRows.length>0,"Записать фактические результаты плейтеста по сценариям."],[qaRows.length>0 && qaRows.every(row=>/\|\s*PASS\s*\|/i.test(row)),"Пройти все перечисленные проверки, включая перезапуск."]],
    finish:[[!!meaningful.finish,"Указать сборку и способ запуска."],[false,"Подтвердить передачу проверенной сборки в карточке."]]
  };
  const guided=plan.workflowVersion===2;
  const decision={};
  if(guided){
    const revision=state.idea_revision??1;
    const current=Number.isSafeInteger(revision) && revision>0 && state.research_revision===revision;
    const chosen=value=>["A","B","C"].includes(value);
    decision.research=[current && state.research_decision==="keep","Получить решение автора по текущей версии идеи. При изменении повторить исследование целиком."];
    const signed=/^\s*(?:Статус|Status):\s*(?:утвержд[её]н|approved)[.]?[ \t]*$/im;
    decision.concept=[signed.test(meaningful.concept||""),"Утвердить полный концепт и записать «Статус: утверждён»."];
    decision.board=[chosen(state.visual_choice),"Показать три визуальных направления и записать выбор автора."];
    decision.scope=[chosen(state.mvp_choice),"Согласовать один из трёх объёмов MVP."];
    if(executionNote)checks.scope.push([false,"Исправить Feature Index: "+executionNote]);
    checks.research[2]=[current && checks.research[2][0],"Провести полное исследование текущей версии идеи."];
    checks.concept=[[!!(meaningful.concept||"").replace(signed,"").trim(),"Описать полный концепт игры."]];
    const board=meaningful.board||"";
    checks.board=["A","B","C"].map(id=>[new RegExp("^"+id+"[.)]\\s+\\S","m").test(board),"Описать направление "+id+" и приложить визуальный референс."]);
    for(const [id,choice] of Object.entries(decision))checks[id].push(choice);
  }
  for(const n of plan.nodes) {
    const items=checks[n.id]||[[false,n.result]];
    const observed=Math.floor(100*items.filter(([ok])=>ok).length/items.length);
    const manual=n.status==="done"?100:n.status==="planned"?0:(n.progress||0);
    // With an index the build follows the actual features, including newly added ones.
    const referenced=(n.documents||[]).every(name=>filesByStage[n.id].includes(name));
    const recorded=n.progress!==undefined && referenced;
    const finding=reviews.find(s=>s.id===n.id);
    const valid=verified.has(n.id);
    const evidence=valid?finding.evidence:[];
    const fixed=["platform","work-mode"].includes(n.id) || (n.id==="build" && features.length);
    const base=n.id==="build" && features.length?observed:recorded?manual:Math.max(observed,referenced?manual:0);
    let percent=valid && !fixed?Math.max(recorded || n.status==="done"?manual:0,finding.percent):base;
    // A manual percentage or audit cannot supply a missing author decision.
    if(guided && (decision[n.id] || ["platform","work-mode","idea"].includes(n.id))){
      if(observed===100)percent=100;
      else if(percent===100 || fixed)percent=observed;
      if(n.id==="research" && (state.idea_revision??1)>1 && state.research_revision!==state.idea_revision)
        percent=0;
    }
    const status=percent===100?"done":n.status==="waiting"?"waiting":percent>0 || n.status==="active" ||
      (n.id==="build" && features.some(f=>["working","review","building","in_progress","implemented","push_pending"].includes(f.state)))?"active":"planned";
    stages[n.id]={percent,status,evidence,documents:[...new Set([...filesByStage[n.id],...evidence.map(e=>e.path)])],remaining:percent===100?[]:
      (recorded && n.remaining && n.id!=="build"?[n.remaining]:[...(n.remaining?[n.remaining]:[]),...items.filter(([ok])=>!ok).map(([,todo])=>todo)])};
    if(valid && !fixed && percent<100 && finding.remaining)stages[n.id].remaining=[...new Set([n.remaining,finding.remaining].filter(Boolean))];
    if(guided && percent<100 && decision[n.id] && !decision[n.id][0] && !stages[n.id].remaining.includes(decision[n.id][1]))
      stages[n.id].remaining.push(decision[n.id][1]);
    if(finding && !valid)stages[n.id].remaining.push("Доказательства изменились. Обновите аудит проекта.");
  }
  const notes=files.filter(f=>/(^|\/)(?:\d{4}-\d{2}-\d{2}-)?handoff\.md$/i.test(f)).sort().reverse();
  const checkpoint=notes[0] && readText(docPath(root,notes[0])).match(/^(?:Дальше|Следующий шаг|Next step):\s*(.+)$/im)?.[1];
  const nextAction=checkpoint || (typeof state.next_action==="string" && state.updated_at?state.next_action:"");
  return {stages,features,doneFeatures:count,choices,warnings,executionNote,nextAction,lastAudit,checkpoint:notes[0]||""};
}
module.exports={audit,docPath,saveReview};
