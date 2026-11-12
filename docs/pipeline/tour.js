"use strict";
(() => {
  const steps = [
    {node:"idea", title:"Начните с действия игрока", text:"Скажите Codex в папке игры «Хочу сделать игру» и опишите идею. Например, игрок собирает искры, чтобы маяк не погас. Нажмите на подсвеченный блок схемы — в карточке видны скилл, статус и ожидаемый результат."},
    {node:"research", title:"Посмотрите похожие игры", text:"Разрешите исследование. Посмотрите ссылки и гипотезу и выберите, оставить идею или изменить её. Для изменённой идеи исследование повторяется целиком."},
    {node:"concept", title:"Утвердите полный концепт", text:"Геймдизайнер задаёт по 10 вопросов с вариантами. Можно ответить «1А, 2Б» или своими словами. После интервью прочитайте документ и подтвердите концепт."},
    {node:"board", title:"Выберите визуальный стиль", text:"Сравните три направления. Ваш референс может стать одним из них. Укажите, какой вариант взять за основу."},
    {node:"scope", title:"Согласуйте объём MVP", text:"Сравните три объёма по механикам и очередности. После выбора проверьте Feature Index с F-ID, зависимостями и критериями приёмки."},
    {node:"platform", title:"Укажите, где будет работать игра", text:"В блоке «Выбор платформы» задайте движок, устройство и 2D или 3D. Во вкладке «Скиллы по этапам» появится состав сборки для этого выбора."},
    {node:"work-mode", title:"Кто выбирает следующую фичу?", text:"Сравните два режима. Для своей игры вы зафиксируете один из них в блоке «Режим работы» после выбора платформы."},
    {node:"qa", title:"Примите результат в игре", text:"Скачайте JSON плана и откройте доску фич по инструкции Робокопа. Проверяйте результат и отвечайте на вопросы в карточке F-ID. После сборки пройдите полный раунд и проверьте перезапуск."}
  ];
  const descriptions = {
    manual:"Вы выбираете доступный F-ID. Codex делает фичу, вы смотрите результат и решаете, отправить ли коммит в выбранную ветку.",
    robocop:"Робокоп берёт доступные F-ID по очереди, запускает проверки и отправляет отдельный коммит каждой фичи в выбранную ветку. Вопросы остаются на доске."
  };
  const key = "game-factory-kit.tour.v1";
  const panel = $("tour");
  let index = 0;
  let previous = null;
  function remember(value) {
    try { localStorage.setItem(key, value); } catch { /* The tour also works without storage. */ }
  }
  function clearHighlight() {
    document.querySelector(".tour-target")?.classList.remove("tour-target");
  }
  function compare(mode) {
    for (const button of $("tourModes").querySelectorAll("button"))
      button.setAttribute("aria-pressed", button.dataset.mode === mode);
    $("tourModeText").textContent = descriptions[mode];
  }
  function display() {
    clearHighlight();
    const step = steps[index];
    $("tourStep").textContent = "Обучение · "+(index+1)+" из "+steps.length;
    $("tourTitle").textContent = step.title;
    $("tourText").textContent = step.text;
    $("tourBack").disabled = index===0;
    $("tourNext").textContent = index===steps.length-1 ? "К первому блоку →" : "Дальше →";
    $("tourModes").hidden = step.node!=="work-mode";
    if (!$("tourModes").hidden) compare("manual");
    showView("map");
    const node = nodeById(step.node);
    if (node) {
      $("cards").querySelector('[data-id="'+step.node+'"]')?.classList.add("tour-target");
      centerNode(node);
    }
    remember(String(index));
  }
  function start(at=0) {
    if (panel.hidden) {
      previous = {view:$("skillsView").hidden ? ($("tasks").hidden?"map":"tasks") : "skills",
        x:$("viewport").scrollLeft,y:$("viewport").scrollTop};
    }
    panel.hidden=false;index=at;display();
  }
  function finish(restore=true) {
    panel.hidden=true;clearHighlight();remember("done");
    if (restore && previous) {
      showView(previous.view);
      if(previous.view==="skills") renderSkillGroups();
      $("viewport").scrollTo(previous.x,previous.y);
    }
    $("tourStart").focus({preventScroll:true});
  }
  $("tourStart").onclick=()=>{start();$("tourNext").focus();};
  $("tourSkip").onclick=()=>finish();
  $("tourBack").onclick=()=>{if(index>0){index--;display();}};
  $("tourNext").onclick=()=>{
    if(index<steps.length-1){index++;display();return;}
    finish(false);
    const first=plan.nodes.find(n=>n.kind==="start");
    if(first){centerNode(first);openEditor(first);}
  };
  for(const button of $("tourModes").querySelectorAll("button")) button.onclick=()=>compare(button.dataset.mode);
  // A deliberate change of workspace tab leaves the walkthrough.
  for(const id of ["mapTab","skillsTab","tasksTab"]) $(id).addEventListener("click",()=>{
    if(!panel.hidden) finish(false);
  });
  function linkedStep() {
    if(location.hash==="#ftue") return 0;
    if(location.hash==="#modes") return steps.findIndex(step=>step.node==="work-mode");
    return null;
  }
  function followLink() {
    const at=linkedStep();
    if(at===null) return false;
    start(at);
    try {history.replaceState(null,"",location.href.split("#")[0]);} catch {}
    return true;
  }
  window.addEventListener("hashchange",followLink);
  function enterTour() {
    if(followLink())return;
    if(connectedProject && new URLSearchParams(location.search).get("guided")==="1")return;
    let saved=null;
    try {saved=localStorage.getItem(key);} catch {}
    if(connectedProject && saved===null && Object.values(projectData.stages).some(s=>s.percent>0))return;
    if(saved!=="done") {
      const at=Number(saved);
      start(Number.isInteger(at) && at>=0 && at<steps.length ? at : 0);
    }
  }
  if(connectedProject && !projectData)window.addEventListener("gfk-project-ready",enterTour,{once:true});
  else enterTour();
})();
