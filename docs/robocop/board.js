"use strict";
const $=id=>document.getElementById(id);
const labels={ready:"В очереди",working:"В работе",question:"Нужен ответ",deferred:"Отложен",review:"На ревью",publishing:"Публикация",push_pending:"Ожидает push",done:"Готово",cut:"Вне объёма"};
let board,filter="all",card;
const attention=c=>["question","review","push_pending"].includes(c.state);
function el(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
async function api(url,opts){
  const r=await fetch(url,opts),data=await r.json();if(!r.ok)throw Error(data.error||"Доска недоступна.");return data;
}
async function act(type,id,value,previous){
  try{
    await api("/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,id,value,previous})});
    $("msg").textContent="";if($("card").open)$("card").close();await refresh();
  }catch(e){if($("card").open)alert(e.message);else $("msg").textContent=e.message;}
}
function draw(){
  $("platform").textContent=board.platform+" · "+board.target.remote+"/"+board.target.branch;
  $("mode").textContent=(board.mode==="manual"?"Ручной режим":"Режим Робокопа")+(board.busy?" · исполнитель работает":"");
  $("run").hidden=board.mode==="manual"||board.busy;$("run").disabled=!board.ready.length;$("stop").hidden=!board.busy;
  $("inbox").textContent="Требуют решения · "+board.cards.filter(attention).length;
  for(const key of ["all","inbox","later"]) $(key).setAttribute("aria-pressed",key===filter);
  const rows=board.cards.filter(c=>filter==="all"||(filter==="inbox"?attention(c):c.state==="deferred")).map(c=>{
    const b=el("button","");b.className="row";const first=board.ready[0]===c.id;
    b.append(el("small",c.id+" · "+c.priority),el("strong",c.title),el("span",first?"Рекомендуется начать":labels[c.state]));
    b.onclick=()=>show(c.id);return b;
  });
  $("list").replaceChildren(...(rows.length?rows:[el("p","Задач в этом списке нет.")]));
}
async function refresh(){try{board=await api("/board");draw();}catch(e){$("msg").textContent=e.message;}}
function section(parent,title,body){if(body)parent.append(el("h3",title),el("p",body));}
function button(text,fn){const b=el("button",text);b.onclick=fn;return b;}
async function show(id){
  try{card=await api("/card?id="+id);}catch(e){$("msg").textContent=e.message;return;}
  $("fid").textContent=card.id+" · "+labels[card.state];$("title").textContent=card.title;
  $("meta").textContent="Зависимости: "+(card.deps.join(", ")||"нет")+" · Сессий: "+card.turns;
  $("brief").value=card.brief;$("editor").hidden=card.state!=="ready";$("editor").open=false;
  $("preview").replaceChildren(...card.brief.split(/\r?\n/).filter(Boolean).map(line=>
    line.startsWith("## ")?el("h3",line.slice(3)):el("p",line)));
  const out=$("result");out.replaceChildren();section(out,"Результат и проверка",card.summary);
  section(out,"Ход работы",card.progress);
  section(out,"Вопрос",card.question);section(out,"Решения",card.decisions.join("\n\n"));
  section(out,"Передача контекста",card.handoff);section(out,"Коммит",card.sha);
  section(out,"Рабочая копия для просмотра",card.work);
  $("media").replaceChildren();
  for(const file of card.media){
    const video=/\.(mp4|webm)$/i.test(file);const item=document.createElement(video?"video":"img");
    item.src="/media?id="+encodeURIComponent(id)+"&file="+encodeURIComponent(file);if(video)item.controls=true;else item.alt=file;
    $("media").append(item,el("small",file));
  }
  const actions=$("actions");actions.replaceChildren();
  if(card.state==="working")actions.append(button("Обновить отчёт",()=>show(id)));
  if(!board.busy && board.ready.includes(id))actions.append(button("Выполнить эту фичу",()=>act("start",id)));
  if(card.state==="push_pending" && !board.busy)actions.append(button("Повторить push",()=>act("accept",id)));
  if(card.state==="review" && !board.busy)actions.append(button("Принять и отправить в "+board.target.remote+"/"+board.target.branch,()=>act("accept",id)));
  if(["question","deferred","review"].includes(card.state)){
    const reply=document.createElement("textarea");reply.placeholder=card.state==="review"?"Что доработать?":"Ваше решение";actions.append(reply,button("Сохранить ответ",()=>act("answer",id,reply.value)));
    if(card.state==="question")actions.append(button("Отложить",()=>act("defer",id)));
  }
  if(!$("card").open)$("card").showModal();
}
$("save").onclick=()=>act("brief",card.id,$("brief").value,card.brief);
document.querySelector(".close").onclick=()=>$("card").close();
$("run").onclick=()=>act("start");$("stop").onclick=()=>act("stop");
for(const key of ["all","inbox","later"])$(key).onclick=()=>{filter=key;draw();};
refresh();setInterval(refresh,3000);
