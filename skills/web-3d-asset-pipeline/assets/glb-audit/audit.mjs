import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import validator from 'gltf-validator';

function geometrySummary(doc) {
  const accessors = doc.accessors ?? [];
  const meshes = (doc.meshes ?? []).map((mesh, index) => {
    const primitives = mesh.primitives.map(p => {
      const count = accessors[p.indices ?? p.attributes.POSITION].count;
      const mode = p.mode ?? 4;
      const triangles = mode === 4 ? Math.floor(count / 3) : [5,6].includes(mode) ? Math.max(0,count - 2) : 0;
      return {triangles, material: p.material ?? null, mode};
    });
    return {index, name: mesh.name ?? null, triangles: primitives.reduce((n,p) => n+p.triangles,0), primitives};
  }).sort((a,b) => b.triangles-a.triangles);
  const named = items => (items ?? []).map((item,index) => ({index,...item}));
  return {meshTriangles: meshes.reduce((n,m) => n+m.triangles,0), meshes,
    materials: named(doc.materials).map(m => ({index:m.index, name:m.name ?? null, alphaMode:m.alphaMode ?? 'OPAQUE', extensions:Object.keys(m.extensions ?? {})})),
    textures: named(doc.textures).map(t => ({index:t.index, name:t.name ?? null, image:t.source ?? t.extensions?.KHR_texture_basisu?.source ?? null})),
    images: named(doc.images).map(i => ({index:i.index,name:i.name ?? null,mimeType:i.mimeType ?? null,embeddedBytes:doc.bufferViews?.[i.bufferView]?.byteLength ?? null}))};
}

async function inspect(file) {
  const bytes = await readFile(file);
  const report = {file:resolve(file), bytes:bytes.length};
  try {
    const {issues} = await validator.validateBytes(new Uint8Array(bytes), {uri:file, maxIssues:0});
    report.validation = issues;
    if (bytes.toString('ascii',0,4) !== 'glTF' || bytes.readUInt32LE(16) !== 0x4e4f534a) throw Error('Expected a binary GLB with JSON chunk');
    const doc = JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    if (!issues.numErrors) Object.assign(report,geometrySummary(doc));
  } catch (e) {
    report.failure = String(e.message ?? e);
  }
  return report;
}

async function optimize(source, output) {
  const {NodeIO} = await import('@gltf-transform/core');
  const {dedup,prune} = await import('@gltf-transform/functions');
  const {ALL_EXTENSIONS} = await import('@gltf-transform/extensions');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.readBinary(new Uint8Array(await readFile(source)));
  await document.transform(dedup(),prune());
  await writeFile(output, await io.writeBinary(document), {flag:'wx'});
}

const {values,positionals} = parseArgs({allowPositionals:true,options:{
  after:{type:'string'},optimize:{type:'string'},out:{type:'string'},parts:{type:'string'}
}});
if (positionals.length !== 1 || values.after && values.optimize) throw Error('node audit.mjs input.glb [--after optimized.glb | --optimize NEW.glb] [--parts unmerged.glb] [--out report.json]');
const [source] = positionals;
const out = values.out ?? source+'.audit.json';
if ([source,values.after,values.optimize,values.parts].filter(Boolean).some(f=>resolve(f).toLowerCase()===resolve(out).toLowerCase())) throw Error('Report would overwrite an input or model');
const report = {before: await inspect(source)};
const valid = r => !r.failure && r.validation?.numErrors===0;
try {
  if (values.optimize && valid(report.before)) await optimize(source,values.optimize);
  if (values.after || (values.optimize && valid(report.before))) report.after = await inspect(values.after ?? values.optimize);
  if (values.parts) report.beforeBatching = await inspect(values.parts);
  if (report.after && valid(report.after) && valid(report.before)) report.delta = {bytes:report.after.bytes-report.before.bytes,meshTriangles:report.after.meshTriangles-report.before.meshTriangles};
} catch (e) {report.failure=String(e.message ?? e);}
await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log(out);
if (report.failure || [report.before,report.after,report.beforeBatching].filter(Boolean).some(r=>!valid(r))) process.exitCode=1;
