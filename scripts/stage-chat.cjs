"use strict";
const fs=require("node:fs");
const path=require("node:path");
const readline=require("node:readline");
const runs=require("./stage-run.cjs");
const {safeFile}=require("./robocop-board.cjs");

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const schemaFor=stage=>stage==="@audit"?require("./audit-result.json"):require("./stage-result.json");

async function withJob(root,stage,id,action) {
  const file=runs.jobFile(root,stage),lock=file+".lock";
  const fd=fs.openSync(lock,"wx");
  try {
    const job=runs.load(root,stage);
    if(!uuid.test(id) || job?.id!==id)throw Error("Карточка уже содержит другой запуск. Откройте её снова.");
    return await action(job,file);
  } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}

async function begin(root,stage,id,thread) {
  return withJob(root,stage,id,(job,file)=>{
    if(!uuid.test(thread))throw Error("Нужен ID текущего чата. Передайте его последним аргументом команды begin.");
    if(job.mode!=="desktop" || !(job.status==="draft" || (job.status==="running" && job.threadId===thread)))
      throw Error("Этот шаг уже запущен или завершён. Проверьте карточку перед работой.");
    runs.checkStageInputs(root,require("./project.cjs").read(root).plan,stage);
    job.threadId=thread;job.status="running";job.message="Работа идёт в чате Codex.";runs.store(file,job);
    const resultPath=runs.directory+"/"+id+".result.json";
    return [job.prompt,
      "Перед первой фичей и после сжатия прочитай "+path.join(__dirname,"../skills/game-creator/references/context-handoff.md")+". Проверь запас контекста перед каждым F-ID и после проверяемых подшагов. При достаточном запасе продолжай в этом чате.",
      "Если нужна передача, сначала сохрани summary, создай продолжение в той же папке и назови его по F-ID и названию из Feature Index. Перед отправкой задания передай владельца карточки командой",
      'node "'+__filename+'" handoff '+stage+" "+id+" "+thread+' <target-thread-id> "<относительный путь к summary.md>"',
      'Новому чату передай команду node "'+__filename+'" begin '+stage+" "+id+" и путь к summary. Текущий чат после передачи завершает работу.",
      "Перед финальным сообщением запиши результат карточки в "+resultPath+" (UTF-8 JSON).",
      "Схема результата: "+JSON.stringify(schemaFor(stage)),
      'Передай результат карточке командой node "'+__filename+'" finish '+stage+" "+id+" "+thread,
      runs.chatAnswer].join("\n\n");
  });
}
async function handoff(root,stage,id,source,target,checkpoint="docs/game/next-chat-prompt.md") {
  return withJob(root,stage,id,(job,file)=>{
    if(job.mode!=="desktop" || !uuid.test(source) || !uuid.test(target) || source===target)
      throw Error("Нужны разные ID исходного и нового чатов этого запуска.");
    const last=job.handoffs?.at(-1);
    if(job.threadId===target && last?.source===source && last?.target===target)
      return "Карточка уже передана этому чату.";
    if(job.status!=="running" || job.threadId!==source)throw Error("Владелец карточки изменился или запуск завершён.");
    if(!/\.md$/i.test(checkpoint))throw Error("Сначала сохраните summary в Markdown внутри проекта.");
    const summary=fs.readFileSync(safeFile(root,checkpoint),"utf8");
    if(!summary.trim())throw Error("Сначала заполните summary.");
    job.handoffs??=[];
    job.handoffs.push({source,target,checkpoint,date:new Date().toISOString()});
    job.threadId=target;job.message="Продолжение передано в новый чат. Сводка сохранена в "+checkpoint+".";
    runs.store(file,job);
    return "Владелец карточки обновлён. Отправьте поручение в чат "+target+".";
  });
}
async function finish(root,stage,id,thread) {
  return withJob(root,stage,id,async(job,file)=>{
    if(job.mode!=="desktop" || !uuid.test(thread) || job.threadId!==thread)throw Error("Это задание принадлежит другому чату.");
    if(["done","partial","waiting"].includes(job.status))return job.message;
    if(!["running","failed"].includes(job.status))throw Error("Связь с этой карточкой закрыта.");
    const output=safeFile(root,runs.directory+"/"+id+".result.json");
    if(fs.statSync(output).size>128000)throw Error("Слишком большой результат карточки.");
    const result=JSON.parse(fs.readFileSync(output,"utf8").replace(/^\uFEFF/,""));
    if(job.status==="failed"){job.status="running";runs.store(file,job);}
    await runs.perform(root,stage,id,async()=>result,undefined,true);
    const saved=runs.load(root,stage);
    if(saved.status==="failed")throw Error(saved.message);
    return "Результат принят карточкой. "+saved.message;
  });
}
async function detach(root,stage,id) {
  return withJob(root,stage,id,(job,file)=>{
    if(job.mode!=="desktop" || !["running","draft"].includes(job.status))throw Error("Этот чат уже закрыт.");
    job.status="closed";job.message="Чат отвязан. Можно запустить следующий шаг.";runs.store(file,job);
    return runs.publicJob(job);
  });
}

// The automatic worker can submit only this run's result. The game's audit stays read-only.
async function resultServer(root,stage,id) {
  const input=readline.createInterface({input:process.stdin});
  for await(const line of input){
    let req;
    try {
      req=JSON.parse(line);
      if(req.id==null)continue;
      let result;
      switch(req.method){
        case "initialize":
          result={protocolVersion:req.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"gfk_card",version:"1.0"}};break;
        case "ping": result={};break;
        case "tools/list":
          result={tools:[{name:"submit_result",description:"Сохранить подтверждённый результат текущего этапа для карточки Game Factory Kit.",inputSchema:schemaFor(stage)}]};break;
        case "tools/call":{
          if(req.params.name!=="submit_result")throw Error("Неизвестный инструмент.");
          const data=req.params.arguments;
          if(!data || Buffer.byteLength(JSON.stringify(data))>128000)throw Error("Некорректный размер отчёта.");
          await withJob(root,stage,id,job=>{
            if(job.status!=="running" || job.mode!=="auto")throw Error("Запуск уже закрыт.");
            runs.store(safeFile(root,runs.directory+"/"+id+".result.json"),data);
          });
          result={content:[{type:"text",text:"Отчёт передан. Напиши итог для автора с кликабельными ссылками на документы."}]};break;
        }
        default:
          process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:req.id,error:{code:-32601,message:"Method not found"}})+"\n");continue;
      }
      process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:req.id,result})+"\n");
    }catch(e){
      process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:req?.id??null,error:{code:-32602,message:e.message}})+"\n");
    }
  }
}
async function main([command,stage,id,arg,previous,checkpoint]){
  const root=fs.realpathSync(command==="mcp"?arg:process.cwd());
  if(command==="mcp")return resultServer(root,stage,id);
  if(command==="begin")return console.log(await begin(root,stage,id,arg||process.env.CODEX_THREAD_ID));
  if(command==="finish")return console.log(await finish(root,stage,id,arg||process.env.CODEX_THREAD_ID));
  if(command==="handoff")return console.log(await handoff(root,stage,id,arg,previous,checkpoint));
  if(command==="attach")return withJob(root,stage,id,(job,file)=>{
    if(!uuid.test(arg) || job.threadId!==previous || !["done","partial","waiting"].includes(job.status))
      throw Error("Привязка возможна только к завершённому запуску с указанным исходным чатом.");
    job.threadId=arg;runs.store(file,job);
  });
  throw Error("Неизвестная команда карточки.");
}
module.exports={begin,finish,detach,handoff};
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
