"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {spawnSync}=require("node:child_process");
const {codexCommand}=require("./run-pipeline.cjs");
function clean(value,limit=3000) {
  return String(value||"").replace(/\x1b\[[0-9;]*m/g,"")
    .replace(/\b(?:sk-[\w-]{8,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,"[redacted]")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,"$1[redacted]")
    .replace(/(["']?(?:[\w-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret))["']?\s*[:=]\s*)["']?[^\s,"';]+["']?/gi,"$1[redacted]")
    .slice(-limit);
}
function preflight({env=process.env,user=os.userInfo().username,command=codexCommand,run=spawnSync}={}) {
  const result={checkedAt:new Date().toISOString(),user,profile:env.CODEX_HOME||path.join(os.homedir(),".codex"),
    node:process.execPath,command:[],version:"",auth:"не проверено",available:false,reasons:[]};
  if(env.CODEX_SANDBOX_NETWORK_DISABLED==="1" || /^CodexSandbox/i.test(user))
    result.reasons.push("Сервер запущен в изолированной среде Codex. Откройте scripts/start-project.ps1 из обычного PowerShell пользователя.");
  try {
    result.command=command();
    const [bin,...prefix]=result.command;
    const version=run(bin,[...prefix,"--version"],{encoding:"utf8",windowsHide:true,timeout:8000,shell:false});
    if(version.error || version.status!==0)throw Error("Не удалось проверить выбранный Codex CLI: "+clean(version.error?.message||version.stderr));
    result.version=clean(version.stdout,200).trim();
    fs.accessSync(result.profile,fs.constants.R_OK);
    if(!result.reasons.length){
      const auth=run(bin,[...prefix,"login","status"],{encoding:"utf8",windowsHide:true,timeout:8000,shell:false});
      result.auth=auth.status===0?"вход подтверждён":"вход не подтверждён";
      if(auth.status!==0)result.reasons.push("Для выбранного CLI не подтверждён вход. Выполните codex login в обычной оболочке этого пользователя.");
    }
  }catch(e){result.reasons.push(clean(e.message));}
  result.available=!result.reasons.length;
  result.note="Проверка CLI и входа не проверяет ответ модели или доступность сети. Это проверяется при выполнении задания.";
  return result;
}
function powershell(args) {
  const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-File",path.join(__dirname,"process-tree.ps1"),...args],
    {encoding:"utf8",windowsHide:true,shell:false,timeout:15000});
  if(result.error || result.status!==0)throw Error(clean(result.error?.message||result.stderr)||"Не удалось проверить процесс.");
  return JSON.parse(result.stdout.trim());
}
function identity(pid) {
  if(!Number.isInteger(pid) || pid<=0)throw Error("Некорректный PID.");
  if(process.platform==="win32")return powershell(["-ProcessId",String(pid)]);
  if(process.platform==="linux"){
    try {
      const stat=fs.readFileSync(`/proc/${pid}/stat`,"utf8"),fields=stat.slice(stat.lastIndexOf(")")+2).split(" ");
      if(fields[0]==="Z")return null;
      return {pid,started:fields[19],parent:Number(fields[1]),command:fs.readFileSync(`/proc/${pid}/cmdline`,"utf8").replace(/\0/g," ")};
    }catch(e){if(e.code==="ENOENT")return null;throw e;}
  }
  throw Error("Автоматическая отмена доступна на Windows и Linux. Остановите исполнителя в его оболочке.");
}
function alive(record) {
  if(!record)return false;
  const actual=identity(record.pid);
  return !!actual && actual.started===record.started;
}
function stopTree(record) {
  if(!record?.started)throw Error("Нет сохранённого времени создания процесса; автоматическая остановка небезопасна.");
  if(!alive(record))return;
  if(process.platform==="win32")powershell(["-Mode","Stop","-ProcessId",String(record.pid),"-Started",record.started]);
  else {
    // Only children launched as a new process group may use group termination.
    if(!record.group)throw Error("Нет подтверждённой группы процессов для отмены.");
    process.kill(-record.pid,"SIGKILL");
  }
  if(alive(record))throw Error("Процесс ещё работает; повторный запуск пока запрещён.");
}
module.exports={preflight,identity,alive,stopTree,clean};
if(require.main===module)console.log(JSON.stringify(preflight(),null,2));
