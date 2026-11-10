import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {pass} from 'three/tsl';
import {bloom} from 'three/addons/tsl/display/BloomNode.js';
import {$,studio,release,isGlass,effectHint,errorMessage} from './lab.js';

async function start(){
  const {renderer,scene,camera,resize,load}=await studio();
  const controls=new OrbitControls(camera,$('canvas'));
  const pipeline=new T.RenderPipeline(renderer);
  const color=pass(scene,camera).getTextureNode('output');
  pipeline.outputNode=color.add(bloom(color,.4,.3,1));
  const slots={A:[],B:[]}, revision={A:0,B:0}, glassSelections=new WeakMap();
  let visible=null, reference=null, distance=5;
  camera.position.set(3,2,4);
  new ResizeObserver(()=>resize($('canvas').clientWidth,$('canvas').clientHeight,Math.min(devicePixelRatio,2))).observe($('canvas'));
  function pose(){
    if(!reference)return;
    const direction={hero:[.85,.36,1],side:[0,.08,1],rear:[-1,.25,.45]}[$('#pose').value];
    controls.target.copy(reference);camera.position.fromArray(direction).normalize().multiplyScalar(distance).add(reference);
    camera.near=Math.max(.001,distance/1000);camera.far=distance*150;camera.updateProjectionMatrix();controls.update();
  }
  function filters(){
    if(!visible)return;
    const selected=$('#glass').value;glassSelections.set(visible,selected);
    visible.traverse(o=>{if(!o.isMesh)return;
      const materials=[].concat(o.material);
      const matches=m=>selected==='auto'?isGlass(o,m):m.uuid===selected;
      // Material-level filtering also supports multiple primitives on one mesh.
      o.visible=($('#effects').checked||!effectHint.test(o.name))&&(!$('#isolate').checked||materials.some(matches));
      if(Array.isArray(o.material))for(const m of materials)m.visible=!$('#isolate').checked||matches(m);
    });
  }
  function show(){
    if(visible)scene.remove(visible);
    const items=slots[$('#variant').value],idx=Number($('#level').value)||0;
    $('#level').replaceChildren(...items.map((m,i)=>new Option(i+' · '+m.name,i)));
    $('#level').value=String(Math.min(idx,items.length-1));
    const item=items[Number($('#level').value)];visible=item?.root??null;
    $('#glass').replaceChildren(new Option('Авто (по имени / transmission)','auto'));
    if(!visible){$('#status').textContent='Выберите файлы для этого варианта.';return;}
    const mats=new Map();visible.traverse(o=>{if(o.isMesh)for(const m of [].concat(o.material))mats.set(m.uuid,m.name||o.name||m.type)});
    for(const [id,name] of mats)$('#glass').add(new Option(name,id));
    $('#glass').value=glassSelections.get(visible)??'auto';
    scene.add(visible);
    if(!reference){const box=new T.Box3().setFromObject(visible);reference=box.getCenter(new T.Vector3());
      distance=box.getSize(new T.Vector3()).length()*1.55/Math.min(camera.aspect,1);pose();}
    filters();$('#status').textContent=item.name+' · '+$('#variant').value+' · LOD '+$('#level').value;
  }
  for(const key of ['A','B'])$('#files'+key).onchange=async e=>{
    const ticket=++revision[key];
    try{const next=await load(e.target.files);if(ticket!==revision[key]){next.forEach(m=>release(m.root));return}
      const old=slots[key];slots[key]=next;$('#variant').value=key;show();old.forEach(m=>release(m.root));
    }catch(err){errorMessage(err)}
  };
  $('#variant').onchange=$('#level').onchange=show;
  $('#effects').onchange=$('#isolate').onchange=$('#glass').onchange=filters;$('#pose').onchange=pose;
  await renderer.setAnimationLoop(()=>{$('#bloom').checked?pipeline.render():renderer.render(scene,camera)});
}
start().catch(errorMessage);
