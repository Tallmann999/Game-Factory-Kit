"use strict";
const statuses = { planned: "Запланирован", active: "В работе", waiting: "Ждёт ответа", done: "Готово" };
const policies = {
  clarify: "Агент сам спрашивает при нехватке данных",
  confirm: "Обязательно спросить перед началом",
  auto: "Самостоятельно в рамках задания"
};
const engines = ["HTML / Web", "Unity", "Roblox", "Godot", "Другой"];
const builders = ["game-web-builder", "unity-mcp-orchestrator", "game-roblox", "Разработчик Godot", "Разработчик движка"];
const devices = ["Компьютер", "Телефон / планшет", "Компьютер и мобильные"];
const dimensions = ["2D", "3D"];
const platformQuestion = "На какой платформе ты будешь делать свою игру?";
const routedStages = ["build","qa","finish"];
const workModes={manual:"Ручной",robocop:"Робокоп"};
function addModeGate(plan) {
  if(plan.modeGateVersion===1) return plan;
  const platform=plan.nodes.find(n=>n.id==="platform");
  if(!platform || plan.nodes.some(n=>n.id==="work-mode")) return plan;
  const outgoing=plan.edges.filter(e=>e.from==="platform");
  const x=Math.min(50000,platform.x+280);
  let y=platform.y;
  while(y<50000 && plan.nodes.some(n=>Math.abs(n.x-x)<W+20 && Math.abs(n.y-y)<H+20)) y=Math.min(50000,y+H+30);
  plan.nodes.splice(plan.nodes.indexOf(platform)+1,0,{
    id:"work-mode",kind:"design",title:"Режим работы",agent:"game-creator",
    description:"Выберите работу по одной фиче с вашим ревью или автономную очередь Робокопа.",
    result:"Режим выполнения Feature Index",x,y,
    status:"planned",policy:"confirm"
  });
  for(const e of outgoing) e.from="work-mode";
  const gateEdge=edge("platform","work-mode");
  gateEdge.id="platform-work-mode";
  while(plan.edges.some(e=>e.id===gateEdge.id))gateEdge.id+="-";
  plan.edges.push(gateEdge);plan.modeGateVersion=1;
  return plan;
}
function selectMode(plan,mode) {
  if(!plan.platform || !Object.hasOwn(workModes,mode)) throw Error("Выберите платформу и режим работы.");
  plan.workMode=mode;
  const gate=plan.nodes.find(n=>n.id==="work-mode");
  if(gate){gate.status="done";gate.report=workModes[mode];}
}
const phaserSkills = ["phaser-scenes","phaser-input-keyboard-mouse-touch","phaser-data-manager",
  "phaser-animations","phaser-scale-and-responsive","phaser-physics-arcade","phaser-physics-matter"];

function platformLabel(plan) {
  if (!plan.platform) return "Платформа не выбрана";
  return [plan.engine,plan.platform.device,plan.platform.dimension].join(" · ");
}
function choosePlatform(plan,engine,device,dimension) {
  if (!engines.includes(engine) || !devices.includes(device) || !dimensions.includes(dimension))
    throw new Error("Выберите движок, устройство и 2D или 3D.");
  const previous=platformLabel(plan);
  const changed=plan.platform && (engine!==plan.engine || device!==plan.platform.device || dimension!==plan.platform.dimension);
  plan.engine=engine; plan.platform={device,dimension};
  if(changed && plan.workMode){
    delete plan.workMode;
    const gate=plan.nodes.find(n=>n.id==="work-mode");
    if(gate){gate.status="planned";delete gate.progress;delete gate.report;}
  }
  for (const node of plan.nodes) {
    if (node.id==="build") node.agent=builders[engines.indexOf(engine)];
    if (node.id==="platform") {
      node.status="done";
      node.report=platformLabel(plan);
    }
    if (changed && routedStages.includes(node.id) && node.status!=="planned") {
      node.status="planned";
      if (node.report) node.report=("Предыдущая проверка ("+previous+"): "+node.report).slice(0,3000);
    }
  }
}
function routeSkills(plan,stage) {
  if (!plan?.platform || !routedStages.includes(stage)) return [];
  const web=plan.engine==="HTML / Web", three=plan.platform.dimension==="3D";
  const mobile=plan.platform.device!==devices[0], engineSkill=builders[engines.indexOf(plan.engine)];
  const specialist=["Unity","Roblox"].includes(plan.engine) ? [engineSkill] : [];
  switch(stage) {
    case "build": return ["game-ui-design",...(plan.engine==="Roblox"?["game-roblox-ui","scenario-roblox-expert"]:[]),"game-audio","game-asset-pipeline",...(web?["playwright"]:[]),
      ...(web && !three?phaserSkills:[]),...(web && three?["three-webgl-game","web-3d-asset-pipeline"]:[]),...(three?["blender-core"]:[]),...(mobile?["game-mobile"]:[])];
    case "qa": return [...specialist,...(plan.engine==="Roblox"?["game-roblox-ui","scenario-roblox-expert","scenario-roblox-performance"]:[]),...(web?["playwright"]:[]),...(mobile?["game-mobile"]:[]),
      ...(web && three?["game-playtest"]:[]),...(three?["blender-asset-qa","blender-game-optimization"]:[])];
    case "finish": return ["game-qa",...specialist,...(web?["playwright"]:[]),...(mobile?["game-mobile"]:[]),
      ...(three?["blender-export-pipelines"]:[])];
  }
}
function matchesPlatform(plan,stage,name) {
  if(name==="game-3d-props")return !plan?.platform || (plan.platform.dimension==="3D" && ["HTML / Web","Unity","Roblox"].includes(plan.engine));
  if(["three-webgl-game","web-3d-asset-pipeline","game-playtest"].includes(name))return !plan?.platform || (plan.engine==="HTML / Web" && plan.platform.dimension==="3D");
  if(["game-roblox-ui","scenario-roblox-expert","scenario-roblox-performance"].includes(name))return plan?.engine==="Roblox";
  if (!plan?.platform || !routedStages.includes(stage)) return true;
  if (name.startsWith("phaser-")) return plan.engine==="HTML / Web" && plan.platform.dimension==="2D";
  if (name==="playwright") return plan.engine==="HTML / Web";
  if (builders.includes(name)) return name===builders[engines.indexOf(plan.engine)];
  if (name==="game-mobile") return plan.platform.device!==devices[0];
  if (name.startsWith("blender-")) return plan.platform.dimension==="3D";
  return true;
}
const kinds = {
  start: ["Старт", "✦", "#5a742d", "#e6f3cc"],
  design: ["Проектирование", "◇", "#65529a", "#ede7fa"],
  build: ["Разработка", "⌘", "#276c86", "#dbedf3"],
  test: ["Проверка", "✓", "#986026", "#faeaca"],
  finish: ["Результат", "⚑", "#377654", "#def0e2"]
};
const makeId = () => crypto.randomUUID();
const sides = ["l", "r", "t", "b"];
const W = 202, H = 154;
function edge(from, to, out = "r", into = "l") {
  return {id:makeId(), from, to, out, into, bend:null};
}
const guidedStages = [
  ["idea","start","Я хочу сделать игру","game-creator","Запишите исходную идею словами автора и основное действие игрока. Покажите зелёную карточку и спросите, запускать ли исследование.","Сохранённая идея в idea.md."],
  ["research","design","Исследование","game-market-research","Сравните реальные аналоги, покажите страницы игр и проверяемую гипотезу. Спросите: сохраняем идею и начинаем интервью или меняем идею и повторяем исследование целиком?","Исследование текущей версии идеи со ссылками и решением автора."],
  ["concept","design","Концепт игры","game-design","Проведите интервью о полной игре раундами по 10 вопросов, по 2–3 варианта и свой ответ. Сохраняйте сквозную нумерацию и ответы. Покажите весь концепт автору.","Полный concept.md без открытых ключевых решений, утверждённый автором."],
  ["board","design","Визуальное направление","game-art-director","Покажите три разных визуальных направления, включая вариант по референсу автора, если он предоставлен. Дождитесь выбора.","Доска с тремя направлениями и выбранным автором стилем в art-direction.md."],
  ["scope","design","Объём MVP","game-mvp","Предложите три объёма по концепту. Покажите механику первой очереди, последующие механики и исключения. После выбора составьте Feature Index.","Выбранный объём и Feature Index с F-ID, порядком, зависимостями и приёмкой."],
  ["platform","design","Выбор платформы","game-creator","Спросите, на каком движке, для какого устройства и в 2D или 3D создавать прототип.","Подтверждены движок, устройство и размерность."],
  ["work-mode","design","Режим работы","game-creator","Сверьте концепт, стиль, объём MVP, Feature Index и платформу. Спросите: выбирать фичи вручную или поручить очередь Робокопу?","Автор выбрал режим выполнения Feature Index."],
  ["build","build","Сборка прототипа","game-web-builder","Соберите игровой цикл по принятому Feature Index в выбранном режиме.","Играбельная сборка и инструкция запуска."],
  ["qa","test","Плейтест и QA","game-qa","Пройдите раунд, проверьте управление и перезапуск. Зафиксируйте результат.","Отчёт о проверке и решение о готовности."],
  ["finish","finish","Готовая игра","game-creator","Передайте проверенную сборку на выбранном движке.","Путь к сборке, способ запуска и результаты проверки."]
];
function initialPlan() {
  const nodes=guidedStages.map(([id,kind,title,agent,description,result],i)=>({
    id,kind,title,agent,description,result,x:56+i*280,y:152,status:"planned",policy:"confirm"
  }));
  return {version:1,workflowVersion:2,modeGateVersion:1,engine:engines[0],nodes,
    edges:nodes.slice(1).map((node,i)=>edge(nodes[i].id,node.id))};
}
// Upgrade the old stock sequence. User-designed graphs retain their own dependencies.
function upgradePlan(plan) {
  if(plan.workflowVersion===2)return plan;
  const mode=plan.nodes.some(n=>n.id==="work-mode");
  if(!mode && plan.nodes.length===9 && ["idea/research","research/concept","concept/scope","scope/platform","platform/board","board/build","build/qa","qa/finish"]
    .every(pair=>plan.edges.some(e=>e.from+"/"+e.to===pair)))addModeGate(plan);
  const old=["idea","research","concept","scope","platform","work-mode","board","build","qa","finish"];
  if(plan.nodes.length!==old.length || plan.edges.length!==old.length-1 ||
    !old.slice(1).every((id,i)=>plan.edges.some(e=>e.from===old[i] && e.to===id)))return plan;
  const legacyXY=[[56,176],[336,72],[336,306],[616,306],[616,72],[896,72],[1176,72],[1176,306],[1456,306],[1736,176]];
  const unchangedLayout=old.every((id,i)=>plan.nodes.some(n=>n.id===id && n.x===legacyXY[i][0] && n.y===legacyXY[i][1]));
  const oldText={
    "idea":["Опишите, что делает игрок и почему ему захочется продолжить.", "Идея и открытые вопросы в idea.md."],
    "research":["Сравните близкие игры и выделите проверяемую гипотезу.", "Референсы, факты и гипотезы в research.md."],
    "concept":["Автор описывает игру после исследования аналогов: основные механики, пиллары, аудиторию, правила успеха и ошибки. Агент структурирует ответы и запрашивает подтверждение автора.", "Утверждённое автором описание игры в concept.md."],
    "scope":["Выберите минимальный набор функций для одного раунда.", "Feature Index с приоритетами и критериями приёмки."],
    "platform":["Уточните движок, устройство, размерность и управление.", "Выбранная платформа и ограничения прототипа."],
    "board":["Сравните варианты камеры и стиля или зафиксируйте явный пропуск.", "Выбранный референс или решение о пропуске доски."],
    "build":["Соберите игровой цикл с началом, концом и повторным запуском.", "Играбельная сборка и инструкция запуска."],
    "qa":["Пройдите раунд, проверьте управление и перезапуск. Зафиксируйте результат.", "Отчёт о проверке и решение о готовности."],
    "finish":["Передайте проверенную сборку на выбранном движке.", "Путь к сборке, способ запуска и результаты проверки."],
    "work-mode":["Выберите работу по одной фиче с вашим ревью или автономную очередь Робокопа.", "Режим выполнения Feature Index"],
  };
  const replace={concept:"board",board:"scope","work-mode":"build"};
  for(const e of plan.edges)if(replace[e.from]){e.to=replace[e.from];e.bend=null;e.out="r";e.into="l";}
  const original=new Map(plan.nodes.map(n=>[n.id,n]));
  plan.nodes=guidedStages.map(([id,,,,description,result],i)=>{
    const n=original.get(id);
    if(n.description===oldText[id][0])n.description=description;
    if(n.result===oldText[id][1])n.result=result;
    n.policy="confirm";
    if(unchangedLayout){n.x=56+i*280;n.y=152;}
    return n;
  });
  if(unchangedLayout)for(const e of plan.edges){e.out="r";e.into="l";e.bend=null;}
  plan.workflowVersion=2;
  return plan;
}
function unfinishedInputs(plan,id,status) {
  const pending=[id],seen=new Set(pending);
  const i=plan.workflowVersion===2?guidedStages.findIndex(stage=>stage[0]===id):-1;
  for(const [prior] of guidedStages.slice(0,Math.max(0,i))) {seen.add(prior);pending.push(prior);}
  while(pending.length){
    const next=pending.pop();
    for(const e of plan.edges)if(e.to===next && !seen.has(e.from)){seen.add(e.from);pending.push(e.from);}
  }
  seen.delete(id);
  const nodes=new Map(plan.nodes.map(n=>[n.id,n]));
  return [...seen].filter(key=>!nodes.has(key) || status(nodes.get(key))!=="done")
    .map(key=>nodes.get(key) || {id:key,title:guidedStages.find(s=>s[0]===key)?.[2]||key});
}
function checkDiagram(plan) {
  const fail = () => { throw new Error("Файл содержит некорректные этапы или связи."); };
  if (!plan || plan.version !== 1 || !engines.includes(plan.engine) || !Array.isArray(plan.nodes) ||
      !Array.isArray(plan.edges) || plan.nodes.length > 300 || plan.edges.length > 1500) fail();
  const ids = new Set(), wires = new Set(), pairs = new Set();
  if(plan.gitTarget!=null && !["branch","remote"].every(key=>typeof plan.gitTarget[key]==="string" && /^[^\s\x00-\x1f]{1,255}$/.test(plan.gitTarget[key]) && !plan.gitTarget[key].startsWith("-"))) fail();
  if(plan.workMode!==undefined && !Object.hasOwn(workModes,plan.workMode)) fail();
  if (plan.platform!=null && (!devices.includes(plan.platform.device) || !dimensions.includes(plan.platform.dimension))) fail();
  const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
  const coord = value => Number.isFinite(value) && value >= 0 && value <= 50000;
  for (const n of plan.nodes) {
    if (!n || !validId(n.id) || ids.has(n.id) || !Object.hasOwn(kinds,n.kind) || !Object.hasOwn(statuses,n.status) ||
        !Object.hasOwn(policies,n.policy) || !coord(n.x) || !coord(n.y)) fail();
    for (const field of ["title","description","agent","result"]) {
      if (typeof n[field] !== "string" || n[field].length > 3000 || (field !== "description" && !n[field].trim())) fail();
    }
    if(n.progress!==undefined && (!Number.isInteger(n.progress)||n.progress<0||n.progress>100)) fail();
    if(n.remaining!==undefined && (typeof n.remaining!=="string" || n.remaining.length>3000)) fail();
    if(n.documents!==undefined && (!Array.isArray(n.documents) || n.documents.length>100 || n.documents.some(p=>typeof p!=="string" || p.length>500 || !p.trim()))) fail();
    ids.add(n.id);
    if (n.skills !== undefined && (!Array.isArray(n.skills) || n.skills.length>100 ||
        n.skills.some(name=>typeof name!=="string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(name)) ||
        new Set(n.skills).size!==n.skills.length)) fail();
    if (n.report !== undefined && (typeof n.report !== "string" || n.report.length>3000)) fail();
  }
  for (const kind of ["start","finish"]) if (plan.nodes.filter(n=>n.kind===kind).length!==1) fail();
  for (const e of plan.edges) {
    if (!e || !validId(e.id) || wires.has(e.id) || !ids.has(e.from) || !ids.has(e.to) || e.from===e.to ||
        !sides.includes(e.out) || !sides.includes(e.into) || pairs.has(e.from+"/"+e.to) ||
        !(e.bend===null || (e.bend && coord(e.bend.x) && coord(e.bend.y)))) fail();
    wires.add(e.id); pairs.add(e.from+"/"+e.to);
  }
}
function ordered(plan) {
  const incoming = new Map(plan.nodes.map(n=>[n.id,0]));
  const outgoing = new Map(plan.nodes.map(n=>[n.id,[]]));
  const lookup = new Map(plan.nodes.map(n=>[n.id,n]));
  for (const e of plan.edges) {
    outgoing.get(e.from).push(e.to);
    incoming.set(e.to,incoming.get(e.to)+1);
  }
  const queue = plan.nodes.filter(n=>!incoming.get(n.id));
  for (let i=0; i<queue.length; i++) {
    for (const id of outgoing.get(queue[i].id)) {
      incoming.set(id,incoming.get(id)-1);
      if (!incoming.get(id)) queue.push(lookup.get(id));
    }
  }
  if (queue.length!==plan.nodes.length) throw new Error("В схеме цикл. Удалите обратную зависимость.");
  return queue;
}
function verifyRoute(plan) {
  const order = ordered(plan);
  for (const n of order) {
    const prev = plan.edges.some(e=>e.to===n.id), next = plan.edges.some(e=>e.from===n.id);
    if (prev === (n.kind==="start") || next === (n.kind==="finish"))
      throw new Error("Проверьте связи этапа «"+n.title+"». Все этапы должны вести от идеи к готовой игре.");
  }
  return order;
}
function extraSkills(node,plan) {
  const skills=new Set([...routeSkills(plan,node.id),...(node.skills || [])]);
  skills.delete(node.agent);
  return Array.from(skills).filter(name=>matchesPlatform(plan,node.id,name));
}
function assetOffer(plan,node) {
  if(!node || !matchesPlatform(plan,node.id,"game-3d-props"))return [];
  if(node.id!=="build" && ![node.agent,...(node.skills||[])].some(name=>["game-asset-pipeline","game-3d-props"].includes(name)))return [];
  return ["Если автор просит сделать простые формы или найти ассеты для 3D-предмета, сначала предложи Sand3D по размерам, Hunyuan3D по изображению и исходный способ (примитивы или поиск). Для генерации нужен явный выбор автора для этого заказа. Пока выбора нет, задай вопрос и дождись ответа. При выборе генератора используй game-3d-props. Запуск этапа и отметка скилла сами по себе не подтверждают генерацию."];
}
function briefing(plan) {
  const order = verifyRoute(plan);
  if (!plan.platform) throw new Error(platformQuestion+" Зафиксируйте выбор в конструкторе.");
  const lines = ["# Задание Game Factory Kit", "", "Платформа: "+platformLabel(plan), "",
    "После каждой принятой F-ID обнови Feature Index, сделай один коммит и push. Назначение: "+(plan.gitTarget?plan.gitTarget.remote+"/"+plan.gitTarget.branch:"обязательно спроси ветку и remote до начала фичи")+".",
    "Режим реализации: "+(workModes[plan.workMode]||"сначала спросить пользователя")+". Концепт, основные механики и пиллары утверждает автор. Для реализации используй очередь Робокопа по F-ID. Полный бриф, результаты, решения и медиа хранятся в карточке фичи. В чат выводи только новые F-ID для решения и завершённые F-ID.",
    "Работай только в разрешённом блоке. До перехода покажи результат и дождись решения автора о следующем блоке. Этап в работе сначала сверяй с текущими файлами. Для этапа со статусом «Ждёт ответа» получи ответ перед продолжением. Готовые этапы используй как входы. Передавай дальше реальные результаты и пути к ним. Выполненные проверки и оставшиеся вопросы записывай в документы проекта. При отсутствии подтверждения оставь этап открытым.", ""];
  for (const [index,n] of order.entries()) {
    const deps = plan.edges.filter(e=>e.to===n.id).map(e=>order.find(a=>a.id===e.from));
    lines.push("## "+(index+1)+". "+n.title+" ["+n.id+"]", "Исполнитель: "+n.agent, "Входы: "+(deps.map(d=>d.title+" ["+d.id+"]").join(", ")||"идея пользователя"),
      ...extraSkills(n,plan).map(name=>"Подключить скилл: "+name),
      ...assetOffer(plan,n),
      "Статус: "+statuses[n.status], "Режим: "+policies[n.policy], "Задача: "+n.description, "Приёмка: "+n.result,
      "Фактический результат: "+(n.report||"ещё не записан"), "");
  }
  return lines.join("\n");
}
if (typeof module!=="undefined" && module.exports) {
  module.exports={upgradePlan,unfinishedInputs,ordered,checkDiagram,verifyRoute,policies,statuses,initialPlan,briefing,extraSkills,assetOffer,
    engines,devices,dimensions,platformLabel,platformQuestion,choosePlatform,routeSkills,matchesPlatform,routedStages,selectMode,workModes};
}
