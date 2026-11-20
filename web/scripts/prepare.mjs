import {readFile, mkdir, copyFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import validator from 'gltf-validator';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {FloatType} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {bed, getPlatePartBounds, plates} from '../src/print-layout.js';
const web=fileURLToPath(new URL('../',import.meta.url));
const root=path.resolve(web,'..');
const manifest=JSON.parse(await readFile(path.join(web,'public/model/manifest.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [name,expected] of Object.entries(manifest.inputs)){
  if(hash(await readFile(path.join(root,name)))!==expected)throw new Error(`Web model is stale: ${name}. Run scripts/export_web_model.py with Blender.`);
}
const glb=await readFile(path.join(web,'public/model/nc04.glb'));
if(hash(glb)!==manifest.glb_sha256)throw new Error('GLB hash differs from its export manifest');
const report=await validator.validateBytes(new Uint8Array(glb),{uri:'nc04.glb',maxIssues:30});
if(report.issues.numErrors)throw new Error(JSON.stringify(report.issues,null,2));
const doc=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());
if(doc.animations?.[0]?.name!=='Assembly'||!doc.materials?.some(m=>m.name==='Tab5 rear • M5Stack reference photograph'))throw new Error('Missing assembly animation or Tab5 rear material');
if(!doc.extensionsUsed.includes('KHR_materials_transmission'))throw new Error('Missing PBR glass transmission');
await mkdir(path.join(web,'public/project'),{recursive:true});
for(const [source,target] of [
  ['preview-nc04.jpg','poster.jpg'],
  ['fonts/null-font/NULLFont-Italic.woff2','NULLFont-Italic.woff2'],
  ['fonts/null-font/OFL.txt','OFL.txt'],
  ['LICENSES/CC-BY-4.0.txt','CC-BY-4.0.txt'],
  ['LICENSES/MIT.txt','MIT.txt'],
  ['docs/references/tab5/LICENSE','M5STACK-MIT.txt'],
])await copyFile(path.join(root,source),path.join(web,'public/project',target));
await writeFile(path.join(web,'public/project/build.json'),JSON.stringify({model:manifest.glb_sha256,source:manifest.inputs['NULL_CITY_NC04.blend']}));
console.log(`Verified GLB: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings; ${(glb.length/1024/1024).toFixed(2)} MiB. Sources match Blender export.`);

const printer=JSON.parse(await readFile(path.join(root,'print/h3c/machine.json'),'utf8'));
if(!printer.printable_area.includes(`${bed.width}x${bed.depth}`))throw new Error('Print layout bed differs from the H3C profile');
const printDirectory=path.join(web,'public/project/print');
await mkdir(printDirectory,{recursive:true});
const stlLoader=new STLLoader();
const partGeometries=new Map();
for(const plate of plates){
  const bounds=[];
  for(const [name,x,z] of plate.parts){
    if(!partGeometries.has(name)){
      const source=path.join(root,'STL',`${name}.stl`);
      const bytes=await readFile(source);
      const geometry=stlLoader.parse(new Uint8Array(bytes).buffer);
      geometry.rotateX(-Math.PI/2);
      geometry.computeBoundingBox();
      const {min,max}=geometry.boundingBox;
      geometry.translate(-(min.x+max.x)/2,-min.y,-(min.z+max.z)/2);
      partGeometries.set(name,geometry);
      await copyFile(source,path.join(printDirectory,`${name}.stl`));
    }
    const box=getPlatePartBounds(partGeometries.get(name),x,z);
    if(box.min.x < -bed.width/2 || box.max.x > bed.width/2 ||
       box.min.z < -bed.depth/2 || box.max.z > bed.depth/2 ||
       bounds.some(other=>box.intersectsBox(other))){
      throw new Error(`Part is outside its print placement: ${plate.name} / ${name}`);
    }
    bounds.push(box);
  }
}
console.log(`Verified ${plates.length} print plate layouts from the source STL files.`);

const lock=JSON.parse(await readFile(path.join(web,'package-lock.json'),'utf8'));
let notices='NULL CITY Web preview — third-party licenses\n\n';
for(const [location,metadata] of Object.entries(lock.packages)){
  if(!location||metadata.dev)continue;
  const directory=path.join(web,location);
  for(const filename of ['LICENSE','LICENSE.txt','LICENSE.md','license','license.txt']){
    try{
      const text=await readFile(path.join(directory,filename),'utf8');
      notices+=`\n${location.replace('node_modules/','')} ${metadata.version}\n${'='.repeat(60)}\n${text}\n`;
      break;
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
await writeFile(path.join(web,'public/project/THIRD_PARTY_LICENSES.txt'),notices);

const environments=JSON.parse(await readFile(path.join(web,'public/environments/manifest.json'),'utf8'));
let environmentNotices='HDR image-based lighting assets\n\n';
for(const asset of environments){
  const bytes=await readFile(path.join(web,'public/environments',asset.file));
  if(hash(bytes)!==asset.sha256)throw new Error(`HDR integrity check failed: ${asset.file}`);
  const image=new HDRLoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  let peak=0;
  for(let i=0;i<image.data.length;i++){
    if(!Number.isFinite(image.data[i]))throw new Error(`Non-finite HDR value: ${asset.file}`);
    if(i%4!==3)peak=Math.max(peak,image.data[i]);
  }
  if(image.width!==1024||image.height!==512||peak<=1)throw new Error(`Not a 1K high-dynamic-range environment: ${asset.file}`);
  console.log(`HDR verified: ${asset.file}, ${image.width}x${image.height}, peak radiance ${peak.toFixed(2)}`);
  environmentNotices+=`${asset.file}\n${asset.author} / Poly Haven\n${asset.source}\n${asset.license} — ${asset.license_url}\nDownloaded from ${asset.download}\nSHA-256 ${asset.sha256}\n\n`;
}
await writeFile(path.join(web,'public/project/HDRI_CREDITS.txt'),environmentNotices);
