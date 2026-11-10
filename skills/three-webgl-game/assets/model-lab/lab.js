import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
export const $ = selector => document.querySelector(selector);
export const glassHint = /glass|glazing|windscreen|windshield|thermal|стекл|vitre/i;
export const effectHint = /plasma|exhaust.?fx|flame|thruster.?fx|particle|плазм/i;
export function isGlass(mesh,material){return glassHint.test(mesh.name+' '+material.name)||material.transmission>0;}

export async function studio(){
  const canvas=$('canvas');
  const renderer=new T.WebGPURenderer({canvas,antialias:true,forceWebGL:new URLSearchParams(location.search).get('gl')==='1'});
  await renderer.init();
  const backend=renderer.backend.isWebGPUBackend?'WebGPU':'WebGL 2';
  $('#backend').textContent=backend;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  const scene=new T.Scene();
  scene.background=new T.Color(0x242a30);
  const sky=document.createElement('canvas');sky.width=512;sky.height=256;
  const ctx=sky.getContext('2d');const grad=ctx.createLinearGradient(0,0,0,256);
  grad.addColorStop(0,'#b9c1c5');grad.addColorStop(.52,'#a2a5a4');grad.addColorStop(.55,'#44494e');grad.addColorStop(1,'#25282c');
  ctx.fillStyle=grad;ctx.fillRect(0,0,512,256);ctx.fillStyle='#fafafa';ctx.fillRect(82,60,105,28);ctx.fillRect(344,76,45,49);
  const env=new T.CanvasTexture(sky);env.colorSpace=T.SRGBColorSpace;env.mapping=T.EquirectangularReflectionMapping;scene.environment=env;
  scene.add(new T.HemisphereLight(0xffffff,0x767676,1));
  const light=new T.DirectionalLight(0xffffff,2);light.position.set(3,6,4);scene.add(light);
  const camera=new T.PerspectiveCamera(40,1,.01,2000);
  const draco=new DRACOLoader().setDecoderPath('./node_modules/three/examples/jsm/libs/draco/gltf/');
  const ktx=new KTX2Loader().setTranscoderPath('./node_modules/three/examples/jsm/libs/basis/').detectSupport(renderer);
  const loader=new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
  function resize(w,h,pixelRatio=1){renderer.setPixelRatio(pixelRatio);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  async function load(files){
    const models=[];
    try{for(const file of [...files].sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}))){
      const {scene:root}=await loader.parseAsync(await file.arrayBuffer(),'');
      if(new T.Box3().setFromObject(root).isEmpty())throw Error(file.name+' содержит пустую сцену');
      models.push({name:file.name,root});
    }}catch(error){for(const {root} of models)release(root);throw error;}
    return models;
  }
  return {renderer,scene,camera,backend,resize,load};
}
export function release(root){
  const geometry=new Set(),materials=new Set(),textures=new Set();
  root.traverse(o=>{if(!o.isMesh)return;geometry.add(o.geometry);
    for(const m of [].concat(o.material)){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v)}
    o.skeleton?.dispose();
  });
  for(const group of [textures,materials,geometry])for(const resource of group)resource.dispose();
}
export function errorMessage(e){$('#status').textContent='Ошибка: '+(e.message??e);}
