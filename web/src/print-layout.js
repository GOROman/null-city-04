import {BoxGeometry, GridHelper, Group, Mesh, MeshStandardMaterial} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';

export const bed = {width: 330, depth: 320};

export const plates = [
  {name: '下ケース・USB押さえ', parts: [
    ['NC04_01_lower_tray', 0, -26], ['PRINT_USB_bridge_1', -29, 113], ['PRINT_USB_bridge_2', 29, 113],
  ]},
  {name: '上フレーム', parts: [['NC04_02_upper_frame', 0, 0]]},
  {name: '天板', parts: [['NC04_03_control_panel', 0, 0]]},
  {name: 'Tab5 クレードル・スナップガイド', parts: [
    ['NC04_04_tab5_cradle', 0, -24], ['NC04_05_tab5_snap_guide', -22, 31], ['NC04_05_tab5_snap_guide', 22, 31],
  ]},
  {name: '脚', parts: [
    ['PRINT_TPU_foot_-113_-66', -27, -27], ['PRINT_TPU_foot_-113_66', -27, 27],
    ['PRINT_TPU_foot_113_-66', 27, -27], ['PRINT_TPU_foot_113_66', 27, 27],
  ]},
  {name: 'ライトカバー', translucent: true, parts: [
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
  const base=new Mesh(new BoxGeometry(bed.width,3,bed.depth),
    new MeshStandardMaterial({color:0x33414d,roughness:.8}));
  base.position.y=-1.6;
  const grid=new GridHelper(bed.width,33,0x8396a0,0x55626c);
  grid.scale.z=bed.depth/bed.width;
  grid.position.y=-.05;
  group.add(base,grid,...parts);
  return group;
}

export function disposePlate(group){
  group.children[0].geometry.dispose();
  group.children[0].material.dispose();
  group.children[1].geometry.dispose();
  group.children[1].material.dispose();
  group.removeFromParent();
}
