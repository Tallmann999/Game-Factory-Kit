"use strict";
const {execFileSync} = require("node:child_process");
const {createHash} = require("node:crypto");
const path = require("node:path");

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], {encoding:"utf8", stdio:["ignore","pipe","pipe"],
    windowsHide:true, timeout:60000, env:{...process.env, GIT_TERMINAL_PROMPT:"0"}}).trim();
}
function targets(root) {
  try {
    return {branches:git(root,"for-each-ref","--format=%(refname:short)","refs/heads").split("\n").filter(Boolean),
      remotes:git(root,"remote").split("\n").filter(Boolean), current:git(root,"branch","--show-current")};
  } catch { return {branches:[], remotes:[], current:""}; }
}
function requireTarget(root,target) {
  const options=targets(root);
  if(!target || !options.branches.includes(target.branch) || !options.remotes.includes(target.remote) ||
      target.remote.startsWith("-") || target.branch.startsWith("-"))
    throw Error("В какую ветку и какой remote отправлять каждую принятую фичу? Подтвердите выбор в конструкторе.");
  if(options.current!==target.branch) throw Error("В папке игры переключитесь на выбранную ветку "+target.branch+".");
}
function boardDirectory(root,target) {
  const key=createHash("sha256").update(JSON.stringify([target.remote,target.branch])).digest("hex").slice(0,24);
  return path.join(git(root,"rev-parse","--absolute-git-dir"),"gfk-robocop",key);
}
module.exports={git,targets,requireTarget,boardDirectory};
