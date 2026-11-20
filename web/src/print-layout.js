import {BoxGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, SRGBColorSpace} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';

export const bed = {width: 330, depth: 320};

export const plates = [
  {name: '下ケース', seconds: 25751, parts: [['NC04_01_lower_tray', 0, 0]]},
  {name: '上フレーム', seconds: 11096, parts: [['NC04_02_upper_frame', 0, 0]]},
  {name: '天板', seconds: 15199, parts: [['NC04_03_control_panel', 0, 0]]},
  {name: 'Tab5 クレードル・固定台', seconds: 3753, parts: [['NC04_04_tab5_cradle', 0, -44], ['NC04_12_fixed_cradle_mount', 0, 45]]},
  {name: '脚', seconds: 1117, parts: [
    ['PRINT_TPU_foot_-113_-66', -27, -27], ['PRINT_TPU_foot_-113_66', -27, 27],
    ['PRINT_TPU_foot_113_-66', 27, -27], ['PRINT_TPU_foot_113_66', 27, 27],
  ]},
  {name: 'ライトカバー', seconds: 1676, translucent: true, parts: [
    ['PRINT_light_front_diffuser', 0, -42], ['NC04_06_light_left_diffuser', 0, 0], ['NC04_06_light_right_diffuser', 0, 42],
  ]},
];

export function getPlatePartBounds(geometry, x, z) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox.clone();
  box.min.x += x;
  box.max.x += x;
  box.min.z += z;
  box.max.z += z;
  return box;
}

const loader = new STLLoader();
const meshes = new Map();
const solid = new MeshStandardMaterial({color: 0xf2f3f5, roughness: .56});
const translucent = new MeshStandardMaterial({color: 0xd6e9ef, roughness: .44});
const plateEdge = new MeshStandardMaterial({color: 0x33414d, roughness: .8});
let plateSurface;

function getPlateSurface() {
  if(plateSurface)return plateSurface;
  const canvas=document.createElement('canvas');
  canvas.width=bed.width*2;
  canvas.height=bed.depth*2;
  const context=canvas.getContext('2d');
  context.fillStyle='#33414d';
  context.fillRect(0,0,canvas.width,canvas.height);
  for(let x=20;x<canvas.width;x+=20){
    context.fillStyle=x%100===0?'#667683':'#495965';
    context.fillRect(x,0,1,canvas.height);
  }
  for(let y=20;y<canvas.height;y+=20){
    context.fillStyle=y%100===0?'#667683':'#495965';
    context.fillRect(0,y,canvas.width,1);
  }
  const map=new CanvasTexture(canvas);
  map.colorSpace=SRGBColorSpace;
  plateSurface=new MeshStandardMaterial({map,roughness:.8});
  return plateSurface;
}


async function partGeometry(name) {
  if(!meshes.has(name)){
    const promise=loader.loadAsync(`./project/print/${name}.stl`).then(geometry=>{
      geometry.rotateX(-Math.PI/2);
      geometry.computeBoundingBox();
      const {min,max}=geometry.boundingBox;
      geometry.translate(-(min.x+max.x)/2,-min.y,-(min.z+max.z)/2);
      return geometry;
    });
    meshes.set(name,promise);
    promise.catch(()=>meshes.delete(name));
  }
  return meshes.get(name);
}

export async function buildPlate(index){
  const plate=plates[index];
  const parts=await Promise.all(plate.parts.map(async ([name,x,z])=>{
    const geometry=await partGeometry(name);
    const mesh=new Mesh(geometry,plate.translucent?translucent:solid);
    mesh.name=name;
    mesh.position.set(x,0,z);
    return mesh;
  }));
  const group=new Group();
  group.name='NC04PrintPlate';
  group.userData.partCount=parts.length;
  group.userData.plateIndex=index;
  const base=new Mesh(new BoxGeometry(bed.width,3,bed.depth),
    [plateEdge,plateEdge,getPlateSurface(),plateEdge,plateEdge,plateEdge]);
  base.position.y=-1.6;
  group.add(base,...parts);
  return group;
}

export async function buildPrintLayout(selection, columns){
  if(selection!=='all')return buildPlate(Number(selection));

  const groups=await Promise.all(plates.map((_,index)=>buildPlate(index)));
  const layout=new Group();
  layout.name='NC04PrintLayout';
  const rows=Math.ceil(groups.length/columns);
  const gap=28;
  groups.forEach((group,index)=>{
    const row=Math.floor(index/columns);
    const column=index%columns;
    group.position.set((column-(columns-1)/2)*(bed.width+gap),0,
      (row-(rows-1)/2)*(bed.depth+gap));
    layout.add(group);
  });
  return layout;
}

export function disposePlate(group){
  const beds=group.name==='NC04PrintLayout'?[...group.children]:[group];
  for(const plate of beds){
    plate.children[0].geometry.dispose();
  }
  group.removeFromParent();
}
