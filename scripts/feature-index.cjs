"use strict";
const columns={
  id:/^(?:f-id|id)$/i, title:/^(?:результат для игрока|название|фича|feature|title)$/i,
  priority:/^(?:p0\/p1\/later|приоритет|priority)$/i,status:/^(?:статус|status)$/i,
  deps:/^(?:зависимости|dependencies)$/i,acceptance:/^(?:критерий (?:приёмки|готовности)|acceptance)$/i,risk:/^(?:риск|risk)$/i
};
const defaults={id:0,title:1,priority:2,deps:3,acceptance:4,risk:5,status:6};
function rows(md) {
  let fields=defaults;
  const result=[];
  for(const [lineNo,line] of md.split(/\r?\n/).entries()){
    if(!/^\s*\|/.test(line))continue;
    const cells=line.trim().replace(/^\||\|$/g,"").split(/(?<!\\)\|/).map(t=>t.trim().replace(/\\\|/g,"|"));
    if(columns.id.test(cells[0])){
      fields=Object.fromEntries(Object.entries(columns).map(([k,re])=>[k,cells.findIndex(c=>re.test(c))]));
      continue;
    }
    if(!/^F[-_]\d/i.test(cells[0]))continue;
    const row=Object.fromEntries(Object.entries(fields).map(([k,i])=>[k,cells[i]||""]));
    if(!/^F-\d+$/i.test(row.id) || !row.title || !row.priority || !row.status || !row.acceptance || fields.deps<0)
      throw Error("Не удалось прочитать поля Feature Index в строке "+cells[0]);
    result.push({...row,lineNo,statusColumn:fields.status});
  }
  if(!result.length)throw Error("В Feature Index нет заполненных строк F-ID.");
  return result;
}
function parseIndex(md,{inspect=false}={}) {
  const cards=rows(md).map(row=>{
    const {title,acceptance,risk}=row,id=row.id.toUpperCase(),status=row.status.toLowerCase();
    const priority=({MVP:"P0",P0:"P0",P1:"P1",P2:"later",LATER:"later"})[row.priority.toUpperCase()];
    if(!priority || !["planned","building","implemented","verified","blocked","cut","proposed","specified","ready","in_progress","deferred"].includes(status))
      throw Error("Неизвестный приоритет или статус "+id+".");
    if(!inspect && !/^(?:(?:F-\d+[,;\s]*)+|[-—–]|нет|none|n\/a)?$/i.test(row.deps))
      throw Error("Для автоочереди уточните зависимости "+id+": нужны точные F-ID или прочерк. В конструкторе индекс доступен для анализа.");
    const deps=(row.deps.match(/F-\d+/ig)||[]).map(s=>s.toUpperCase());
    return {id,title,priority,indexStatus:status,deps,brief:"## Результат для игрока\n"+title+"\n\n## Приёмка\n"+acceptance+"\n\n## Риск\n"+risk,
      state:({verified:"done",cut:"cut",deferred:"cut",blocked:"question"})[status]||"ready",summary:"",
      question:status==="blocked"?"Уточните решение по блокировке из Feature Index.":"",decisions:[],media:[],handoff:"",turns:0,sha:""};
  });
  const ids=new Map(cards.map(c=>[c.id,c]));
  if(ids.size!==cards.length)throw Error("Повторяющийся F-ID.");
  if(inspect)return cards;
  const seen=new Set(),stack=new Set();
  function visit(id) {
    if(!ids.has(id)||stack.has(id))throw Error("Неизвестная или циклическая зависимость: "+id);
    if(seen.has(id))return;
    stack.add(id);ids.get(id).deps.forEach(visit);stack.delete(id);seen.add(id);
  }
  cards.forEach(c=>visit(c.id));
  return cards;
}
function verifiedIndex(md,id) {
  const row=rows(md).find(r=>r.id.toUpperCase()===id);
  if(!row)throw Error("Нет строки Feature Index для "+id);
  const lines=md.split(/(\r?\n)/), i=row.lineNo*2;
  const cells=lines[i].split(/(?<!\\)\|/), col=row.statusColumn+1;
  cells[col]=cells[col].replace(/\S+/, "verified");lines[i]=cells.join("|");return lines.join("");
}
module.exports={parseIndex,verifiedIndex};
