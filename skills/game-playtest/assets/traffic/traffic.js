import * as T from 'three';
import {$,studio,isGlass,errorMessage,release} from './lab.js';

const WIDTH=960,HEIGHT=540,WARMUP=30,SAMPLES=120;
const positions=Array.from({length:100},(_,i)=>new T.Vector3(i%2?2:-2,0,-Math.floor(i/2)*7-6));
const route=(camera,t)=>{
  const z=4-70*t,x=5.9+.7*Math.sin(t*Math.PI*2);
  camera.position.set(x,4.5,z);camera.lookAt(0,.8,z-14);camera.updateMatrixWorld();
};
function referenceCars(){
  return [14,8,4].map((segments,lod)=>{
    const root=new T.Group();
    function add(name,g,colour,x,y,z){const o=new T.Mesh(g,new T.MeshStandardMaterial({color:colour}));o.name=name;o.position.set(x,y,z);root.add(o)}
    add('Body',new T.BoxGeometry(1.7,.65,3.8),0x586e82,0,.78,0);
    add('Cabin glass',new T.BoxGeometry(1.5,.55,1.9),0x729ab0,0,1.31,.04);
    for(const x of [-.78,.78])for(const z of [-1.18,1.18]){
      add('Hub',new T.CylinderGeometry(.31,.31,.23,segments),0x272a2a,x,.36,z);root.children.at(-1).rotation.z=Math.PI/2;}
    return {name:'Reference LOD '+lod,root};
  });
}
function road(scene){
  const group=new T.Group();scene.add(group);
  const block=(w,h,d,x,y,z,c)=>{const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color:c}));mesh.position.set(x,y,z);group.add(mesh)};
  block(13,.15,380,0,-.11,-175,0x42484b);
  for(const s of [-1,1]){
    block(3,.22,380,s*8,.01,-175,0x737674);
    for(let i=0;i<16;i++)block(5,4+i%4,10,s*12,2,-i*18, i%2?0x65737b:0x75817d);
  }
}
function flatten(model,glass){
  const parts=[],box=new T.Box3().setFromObject(model.root);
  const size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
  const scale=4/Math.max(size.x,size.z,.01);
  const axis=new T.Matrix4().makeRotationY(size.x>size.z?Math.PI/2:0);
  const norm=new T.Matrix4().makeScale(scale,scale,scale).multiply(axis)
    .multiply(new T.Matrix4().makeTranslation(-center.x,-box.min.y,-center.z));
  model.root.updateWorldMatrix(true,true);
  const matCache=new Map();
  model.root.traverse(o=>{
    if(!o.isMesh)return;
    if(o.isSkinnedMesh||o.isInstancedMesh||o.morphTargetInfluences?.length)throw Error('Для теста транспорта нужен статический GLB без скиннинга, морфов и вложенного инстансинга.');
    const geometry=o.geometry.clone().applyMatrix4(norm.clone().multiply(o.matrixWorld));
    const materials=[].concat(o.material).map(m=>{
      const glazing=isGlass(o,m), key=m.uuid+glazing;
      if(!matCache.has(key)){
        const copy=m.clone();
        if(glazing){copy.transparent=glass;copy.opacity=glass?.38:1;copy.depthWrite=!glass;if('transmission' in copy)copy.transmission=0;}
        matCache.set(key,copy);
      }return matCache.get(key);
    });
    parts.push({geometry,material:Array.isArray(o.material)?materials:materials[0]});
  });return parts;
}
function plumes(){
  const g=new T.ConeGeometry(.12,.46,8,1,true);g.rotateZ(Math.PI);g.translate(0,.22,0);
  const m=new T.MeshBasicMaterial({color:0xffbd65,transparent:true,opacity:.48,blending:T.AdditiveBlending,depthWrite:false});
  return [-.7,.7].flatMap(x=>[-1.2,1.2].map(z=>({geometry:g.clone().translate(x,0,z),material:m})));
}
function traffic(scene,models,cfg){
  const parts=models.map(m=>flatten(m,cfg.glass));
  if(cfg.plasma){const jets=plumes();parts.forEach(list=>list.push(...jets))}
  const world=new T.Group();scene.add(world);
  const nodes=parts.map((list,l)=>list.map(part=>{
    if(cfg.instance){
      const mesh=new T.InstancedMesh(part.geometry,part.material,cfg.count);
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;world.add(mesh);return mesh;
    }
    return Array.from({length:cfg.count},(_,i)=>{
      const mesh=new T.Mesh(part.geometry,part.material);mesh.position.copy(positions[i]);
      mesh.rotation.y=i%2?0:Math.PI;mesh.visible=l===0;mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;mesh.updateMatrix();world.add(mesh);return mesh;
    });
  }));
  const placement=new T.Object3D(),matrix=new T.Matrix4(),frustum=new T.Frustum(),probe=new T.Sphere(new T.Vector3(),3.1);
  const transforms=positions.map((p,i)=>{placement.position.copy(p);placement.rotation.y=i%2?0:Math.PI;placement.updateMatrix();return placement.matrix.clone()});
  function update(camera){
    matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix,camera.coordinateSystem,camera.reversedDepth);
    const used=Array(parts.length).fill(0);
    for(let i=0;i<cfg.count;i++){
      probe.center.copy(positions[i]);probe.center.y+=.9;
      const inView=frustum.intersectsSphere(probe),d=camera.position.distanceTo(positions[i]);
      const lod=cfg.lod?Math.min(parts.length-1,[16,32,60].filter(t=>d>t).length):0;
      if(cfg.instance){if(inView){for(const m of nodes[lod])m.setMatrixAt(used[lod],transforms[i]);used[lod]++}}
      else for(let l=0;l<nodes.length;l++)for(const row of nodes[l])row[i].visible=inView&&l===lod;
    }
    if(cfg.instance)nodes.forEach((list,l)=>list.forEach(m=>{m.count=used[l];m.visible=m.count>0;m.instanceMatrix.needsUpdate=true}));
  }
  function dispose(){
    scene.remove(world);world.traverse(o=>{if(o.isInstancedMesh)o.dispose()});
    const gs=new Set(),ms=new Set();parts.flat().forEach(p=>{gs.add(p.geometry);[].concat(p.material).forEach(m=>ms.add(m))});
    gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());
  }
  return {update,dispose};
}
function distribution(values){
  const sorted=[...values].sort((a,b)=>a-b);
  return {mean:values.reduce((a,b)=>a+b,0)/values.length,p95:sorted[Math.ceil(.95*sorted.length)-1],max:sorted.at(-1)};
}
async function start(){
  const {renderer,scene,camera,backend,resize,load}=await studio();
  resize(WIDTH,HEIGHT);road(scene);
  let models=referenceCars(),world=null,running=false;
  const results=[];
  function settings(count){return {count,lod:$('#lod').checked,glass:$('#glass').checked,plasma:$('#plasma').checked,instance:$('#instance').checked}}
  function rebuild(count){world?.dispose();world=traffic(scene,models,settings(count));route(camera,0);world.update(camera);renderer.render(scene,camera)}
  function idle(){rebuild(Number($('#count').value));$('#status').textContent=models.map(m=>m.name).join(' / ')+' · '+WIDTH+' × '+HEIGHT}
  function lock(value){document.querySelectorAll('input,select,#run,#series').forEach(el=>el.disabled=value)}
  $('#files').onchange=async event=>{
    lock(true);
    try{const selected=await load(event.target.files);if(selected.length===0||selected.length>4)throw Error('Выберите от 1 до 4 GLB');
      for(const {root} of selected)root.traverse(o=>{if(o.isSkinnedMesh||o.isInstancedMesh||o.morphTargetInfluences?.length)throw Error('Нужна статическая модель')});
      const previous=models;models=selected;idle();previous.forEach(m=>release(m.root));
    }catch(e){errorMessage(e)}finally{lock(false)}
  };
  for(const id of ['count','lod','glass','plasma','instance'])$('#'+id).onchange=idle;
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  async function measure(count){
    rebuild(count);const frameMs=[],calls=[],tris=[];
    for(let i=0;i<WARMUP;i++){await frame();route(camera,i/(WARMUP-1));world.update(camera);renderer.render(scene,camera)}
    let previous=await frame();
    for(let i=0;i<SAMPLES;i++){
      if(document.hidden)throw Error('Вкладка скрыта. Повторите замер в активной вкладке.');
      route(camera,i/(SAMPLES-1));world.update(camera);renderer.info.reset();renderer.render(scene,camera);
      calls.push(renderer.info.render.drawCalls);tris.push(renderer.info.render.triangles);
      const now=await frame();frameMs.push(now-previous);previous=now;
    }
    return {settings:settings(count),backend,threeRevision:T.REVISION,device:$('#device').value||'unlabelled',browser:navigator.userAgent,
      gpu:renderer.backend.device?.adapterInfo?.description||null,resolution:[WIDTH,HEIGHT],pixelRatio:1,models:models.map(m=>m.name),
      warmup:WARMUP,samples:SAMPLES,route:'street-v1',frameMs:distribution(frameMs),drawCalls:distribution(calls),triangles:distribution(tris)};
  }
  async function run(counts){
    if(running)return;running=true;lock(true);
    try{for(const count of counts){$('#status').textContent='Замер: '+count+' машин…';results.push(await measure(count))}
      $('#count').value=String(counts.at(-1));
      $('#status').textContent=results.slice(-counts.length).map(r=>r.settings.count+' машин · p95 '+r.frameMs.p95.toFixed(1)+' мс · '+r.drawCalls.mean.toFixed(1)+' draw calls · '+Math.round(r.triangles.mean)+' треуг.').join('\n');
    }catch(e){errorMessage(e)}finally{running=false;lock(false);$('#save').disabled=!results.length;}
  }
  $('#run').onclick=()=>run([Number($('#count').value)]);$('#series').onclick=()=>run([1,10,30,100]);
  $('#save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(results,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='traffic-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  idle();
}
start().catch(errorMessage);
