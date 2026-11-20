import {Box3,Color,DataTexture,Float32BufferAttribute,LinearFilter,Plane,Quaternion,Raycaster,RGBAFormat,SRGBColorSpace,Vector2,Vector3,Euler} from 'three';

const BUTTONS=[['B1','PRINT_button_cap_00','U'],['B2','PRINT_button_cap_01','I'],['B3','PRINT_button_cap_02','J'],['B4','PRINT_button_cap_03','O'],['B5','PRINT_button_cap_04','K'],['B6','PRINT_button_cap_05','L'],['P1','PRINT_menu_cap_0','1'],['START','PRINT_menu_cap_1','Enter']];
const KEY_BUTTONS={KeyU:'B1',KeyI:'B2',KeyJ:'B3',KeyO:'B4',KeyK:'B5',KeyL:'B6',Digit1:'P1',Enter:'START'};
const DIRECTIONS={ArrowUp:[0,1],KeyW:[0,1],ArrowDown:[0,-1],KeyS:[0,-1],ArrowLeft:[-1,0],KeyA:[-1,0],ArrowRight:[1,0],KeyD:[1,0]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const limit=(x,y)=>{const n=Math.max(1,Math.hypot(x,y));return [x/n,y/n];};
const color=new Color();const white=new Color(1,1,1);

export class Spring {
  constructor(stiffness=400,damping=27){this.x=0;this.v=0;this.k=stiffness;this.c=damping;}
  step(target,dt){
    const n=Math.max(1,Math.ceil(dt*240));const h=dt/n;
    for(let i=0;i<n;i++){this.v+=(this.k*(target-this.x)-this.c*this.v)*h;this.x+=this.v*h;}
    if(Math.abs(this.x-target)<.0001&&Math.abs(this.v)<.001){this.x=target;this.v=0;}
    return this.x;
  }
  reset(){this.x=0;this.v=0;}
}
function hueRGB(h){
  h=((h%1)+1)%1;const a=h*6;const x=1-Math.abs(a%2-1);
  return a<1?[1,x,0]:a<2?[x,1,0]:a<3?[0,1,x]:a<4?[0,x,1]:a<5?[x,0,1]:[1,0,x];
}

export class Arcade {
  constructor(viewer,composer,pass,onInput){
    this.viewer=viewer;this.composer=composer;this.pass=pass;this.scene=pass.scene;this.onInput=onInput;
    this.active=false;this.power=true;this.mode='rainbow';this.speed=1;this.hex='#00a6cf';this.clock=0;this.pulse=0;
    this.buttons=[];this.pointers=new Map();this.keys=new Set();this.padDirections=new Map();this.drag=null;
    this.stickX=new Spring(190,21);this.stickY=new Spring(190,21);this.ray=new Raycaster();this.ndc=new Vector2();
    this.abort=new AbortController();this.last=performance.now();this.lastPaint=0;
    this.scene.updateMatrixWorld(true);
    for(const [id,name,key] of BUTTONS){
      const node=this.scene.getObjectByName(name);if(!node)throw new Error(`Missing interactive part: ${name}`);
      node.userData.arcadeControl=id;
      this.buttons.push({id,key,node,base:node.position.clone(),quaternion:node.quaternion.clone(),normal:new Vector3(0,1,0).applyQuaternion(node.quaternion),spring:new Spring(),sources:new Set(),until:0});
    }
    const shaft=this.scene.getObjectByName('VISUAL_shaft');const ball=this.scene.getObjectByName('VISUAL_purple_balltop');const washer=this.scene.getObjectByName('VISUAL_dust_washer');
    if(!shaft||!ball||!washer)throw new Error('Missing joystick geometry');
    this.lever=[shaft,ball].map(node=>{node.userData.arcadeControl='STICK';return {node,base:node.position.clone(),quaternion:node.quaternion.clone()};});
    this.leverNormal=shaft.quaternion.clone();
    this.pivot=shaft.parent.worldToLocal(washer.getWorldPosition(new Vector3())).addScaledVector(new Vector3(0,1,0).applyQuaternion(this.leverNormal),-.8);
    this.pickNodes=[...this.buttons.map(b=>b.node),shaft,ball];
    this.leds=[];
    for(const mesh of composer.selection.values()){
      const original=Array.isArray(mesh.material)?null:mesh.material;
      if(!original?.emissive||original.emissive.r+original.emissive.g+original.emissive.b===0)continue;
      const material=original.clone();mesh.material=material;
      const item={mesh,material,strength:material.emissiveIntensity,texture:null,originalMaterial:original,originalGeometry:mesh.geometry,index:this.leds.length};
      if(mesh.name.includes('diffuser')||mesh.name.includes('LED_strip')){
        mesh.geometry=mesh.geometry.clone();const box=new Box3().setFromBufferAttribute(mesh.geometry.attributes.position);const size=box.getSize(new Vector3());
        const axis=size.x>=size.y&&size.x>=size.z?0:size.y>=size.z?1:2;
        const points=mesh.geometry.attributes.position;const uv=new Float32Array(points.count*2);
        for(let i=0;i<points.count;i++){uv[i*2]=(points.getComponent(i,axis)-box.min.getComponent(axis))/Math.max(.001,size.getComponent(axis));uv[i*2+1]=.5;}
        mesh.geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
        const data=new Uint8Array(256*4);const texture=new DataTexture(data,256,1,RGBAFormat);texture.colorSpace=SRGBColorSpace;texture.magFilter=texture.minFilter=LinearFilter;texture.generateMipmaps=false;
        material.emissiveMap=texture;material.needsUpdate=true;item.texture=texture;
      }
      this.leds.push(item);
    }
    const signal=this.abort.signal;
    viewer.addEventListener('pointerdown',e=>this.pointerDown(e),{capture:true,signal});
    for(const type of ['pointermove','pointerup','pointercancel','lostpointercapture'])viewer.addEventListener(type,e=>this.pointer(e),{capture:true,signal});
    window.addEventListener('keydown',e=>this.keyboard(e,true),{signal});window.addEventListener('keyup',e=>this.keyboard(e,false),{signal});
    window.addEventListener('blur',()=>this.releaseAll(),{signal});document.addEventListener('visibilitychange',()=>{if(document.hidden)this.releaseAll();},{signal});
    this.frame=requestAnimationFrame(t=>this.tick(t));this.updateLEDs();
  }
  configure(mode,speed,hex){this.mode=mode;this.speed=Number(speed);this.hex=hex;this.updateLEDs();this.composer.queueRender();}
  setPower(value){this.power=value;this.updateLEDs();this.composer.queueRender();}
  setActive(value){
    if(this.active===value)return;
    this.releaseAll();this.active=value;
    if(!value)this.restore();
    this.composer.queueRender();
  }
  restore(){
    for(const b of this.buttons){b.spring.reset();b.node.position.copy(b.base);}
    this.stickX.reset();this.stickY.reset();
    for(const p of this.lever){p.node.position.copy(p.base);p.node.quaternion.copy(p.quaternion);}
  }
  releaseAll(){
    this.keys.clear();this.padDirections.clear();this.drag=null;
    for(const b of this.buttons){b.sources.clear();b.until=0;}
    for(const id of this.pointers.keys())if(this.viewer.hasPointerCapture(id))this.viewer.releasePointerCapture(id);
    this.pointers.clear();this.report();
  }
  press(id,down,source){
    if(!this.active)return;
    const b=this.buttons.find(b=>b.id===id);if(!b)return;
    if(down){const fresh=!b.sources.has(source);b.sources.add(source);if(fresh){b.until=this.clock+.085;this.pulse=1;}}else b.sources.delete(source);
    this.report();
  }
  pad(direction,down,source){if(!this.active)return;if(down)this.padDirections.set(source,direction);else this.padDirections.delete(source);this.report();}
  stickTarget(){
    if(this.drag)return this.drag.target;
    let x=0,y=0;for(const key of this.keys){const d=DIRECTIONS[key];if(d){x+=d[0];y+=d[1];}}
    for(const d of this.padDirections.values()){x+=d[0];y+=d[1];}
    return limit(x,y);
  }
  keyboard(e,down){
    if(!this.active)return;
    if(down&&(e.ctrlKey||e.metaKey||e.altKey||e.target.closest?.('input,select,textarea,[contenteditable], [data-arcade-control], [data-direction]')))return;
    if(!down&&!this.keys.has(e.code))return;
    if(!DIRECTIONS[e.code]&&!KEY_BUTTONS[e.code])return;
    e.preventDefault();if(down)this.keys.add(e.code);else this.keys.delete(e.code);
    if(KEY_BUTTONS[e.code])this.press(KEY_BUTTONS[e.code],down,`key:${e.code}`);
    this.report();
  }
  rayAt(e){
    const rect=this.viewer.getBoundingClientRect();this.ndc.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    this.scene.updateMatrixWorld(true);this.pass.camera.updateMatrixWorld(true);this.ray.setFromCamera(this.ndc,this.pass.camera);
  }
  pointerDown(e){
    if(!this.active||(e.pointerType==='mouse'&&e.button!==0))return;
    if(e.composedPath().some(x=>x.tagName==='BUTTON'||x.tagName==='INPUT'))return;
    this.rayAt(e);const hit=this.ray.intersectObjects(this.pickNodes,true)[0];if(!hit)return;
    let node=hit.object;while(node&&!node.userData.arcadeControl)node=node.parent;
    const id=node?.userData.arcadeControl;if(!id)return;
    e.preventDefault();e.stopImmediatePropagation();this.viewer.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,id);
    if(id==='STICK'){
      const shaft=this.lever[0].node;const ball=this.lever[1].node;
      const normal=new Vector3(0,1,0).applyQuaternion(shaft.getWorldQuaternion(new Quaternion()));
      const plane=new Plane().setFromNormalAndCoplanarPoint(normal,ball.getWorldPosition(new Vector3()));
      const point=this.ray.ray.intersectPlane(plane,new Vector3());
      this.drag={id:e.pointerId,plane,start:point?.clone(),screen:new Vector2(e.clientX,e.clientY),basis:shaft.getWorldQuaternion(new Quaternion()).invert(),target:[0,0]};this.pulse=1;
    }else this.press(id,true,`pointer:${e.pointerId}`);
  }
  pointer(e){
    if(!this.pointers.has(e.pointerId))return;
    e.preventDefault();e.stopImmediatePropagation();
    if(e.type==='pointermove'&&this.drag?.id===e.pointerId){
      this.rayAt(e);const point=this.ray.ray.intersectPlane(this.drag.plane,new Vector3());
      let x,y;
      if(point&&this.drag.start&&Math.abs(this.ray.ray.direction.dot(this.drag.plane.normal))>.15){const delta=point.sub(this.drag.start).applyQuaternion(this.drag.basis);x=delta.x/.011;y=-delta.z/.011;}
      else{x=(e.clientX-this.drag.screen.x)/45;y=-(e.clientY-this.drag.screen.y)/45;}
      this.drag.target=limit(x,y);this.pulse=Math.max(this.pulse,.35);this.report();
    }else if(e.type!=='pointermove'){
      const id=this.pointers.get(e.pointerId);this.pointers.delete(e.pointerId);
      if(this.drag?.id===e.pointerId)this.drag=null;else this.press(id,false,`pointer:${e.pointerId}`);
      if(this.viewer.hasPointerCapture(e.pointerId))this.viewer.releasePointerCapture(e.pointerId);
      this.report();
    }
  }
  updatePhysics(dt){
    let moving=false;
    for(const b of this.buttons){
      const target=b.sources.size||this.clock<b.until?1:0;const before=b.spring.x;
      b.spring.step(target,dt);b.spring.x=clamp(b.spring.x,-.05,1.02);
      if(b.spring.x===1.02&&b.spring.v>0)b.spring.v*=-.1;
      b.node.position.copy(b.base).addScaledVector(b.normal,-1.8*b.spring.x);moving||=Math.abs(before-b.spring.x)>.00001;
    }
    const [tx,ty]=this.stickTarget();const oldX=this.stickX.x,oldY=this.stickY.x;
    this.stickX.step(tx,dt);this.stickY.step(ty,dt);
    const length=Math.hypot(this.stickX.x,this.stickY.x);
    if(length>1){
      this.stickX.x/=length;this.stickY.x/=length;
      const outward=this.stickX.v*this.stickX.x+this.stickY.v*this.stickY.x;
      if(outward>0){this.stickX.v-=outward*this.stickX.x;this.stickY.v-=outward*this.stickY.x;}
    }
    const tilt=new Quaternion().setFromEuler(new Euler(-this.stickY.x*Math.PI/10,0,-this.stickX.x*Math.PI/10));
    const rotation=this.leverNormal.clone().multiply(tilt).multiply(this.leverNormal.clone().invert());
    for(const p of this.lever){p.node.position.copy(p.base).sub(this.pivot).applyQuaternion(rotation).add(this.pivot);p.node.quaternion.copy(rotation).multiply(p.quaternion);}
    return moving||Math.abs(oldX-this.stickX.x)+Math.abs(oldY-this.stickY.x)>.00001;
  }
  updateLEDs(){
    const selected=this.stickTarget();const direction=(Math.round(Math.atan2(selected[1],selected[0])*4/Math.PI)+8)%8;
    for(const item of this.leds){
      const {mesh,material,index,texture}=item;let reaction=this.pulse*.25;
      const match=mesh.name.match(/LED_button_(\d)/);if(match&&this.buttons[Number(match[1])-1]?.sources.size)reaction=1;
      const dm=mesh.name.match(/direction_(\d+)/);if(dm&&Math.hypot(...selected)>.2&&Number(dm[1])/45===direction)reaction=1;
      if(mesh.name.includes('LED_1P')&&this.buttons[6].sources.size)reaction=1;
      if(mesh.name.includes('LED_START')&&this.buttons[7].sources.size)reaction=1;
      if(this.mode==='solid')reaction=0;
      let level=this.mode==='pulse'?.2+.8*(.5+.5*Math.sin(this.clock*this.speed*2)):this.mode==='reactive'?.22+.78*reaction:1;
      material.emissiveIntensity=item.strength*(1+reaction*.65)*level;
      if(!this.power){material.emissive.setRGB(0,0,0);continue;}
      if(texture){
        material.emissive.setRGB(1,1,1);const data=texture.image.data;
        for(let i=0;i<256;i++){
          if(this.mode==='rainbow'){const rgb=hueRGB(i/256*.8+index*.13-this.clock*this.speed*.12);color.setRGB(...rgb,SRGBColorSpace);}
          else color.set(this.hex);
          color.lerp(white,reaction*.45).convertLinearToSRGB();data[i*4]=color.r*255;data[i*4+1]=color.g*255;data[i*4+2]=color.b*255;data[i*4+3]=255;
        }
        texture.needsUpdate=true;
      }else{
        if(this.mode==='rainbow')material.emissive.setRGB(...hueRGB(index/Math.max(1,this.leds.length)-this.clock*this.speed*.12),SRGBColorSpace);
        else material.emissive.set(this.hex);
        material.emissive.lerp(white,reaction*.7);
      }
    }
  }
  tick(now){
    this.frame=requestAnimationFrame(t=>this.tick(t));
    if(document.hidden||!this.viewer.modelIsVisible){this.last=now;return;}
    if(now-this.lastPaint<32)return;
    // Keep springs in wall-clock time even when software rendering drops frames.
    // Spring.step substeps at 240 Hz, so long visible frames remain stable.
    const dt=Math.min(1,Math.max(0,(now-this.last)/1000));this.last=now;this.lastPaint=now;this.clock+=dt;
    const moving=this.active&&this.updatePhysics(dt);this.pulse*=Math.exp(-dt*5);
    const animated=this.power&&(this.mode==='rainbow'||this.mode==='pulse'||this.pulse>.001||moving);
    if(animated||moving){this.updateLEDs();if(moving)this.scene.queueShadowRender?.();this.composer.queueRender();}
  }
  report(){
    const buttons=this.buttons.filter(b=>b.sources.size).map(b=>b.id);const [x,y]=this.stickTarget();
    const text=JSON.stringify({buttons,x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    if(text!==this.lastInput){this.lastInput=text;this.onInput?.({buttons,x,y});}
  }
  projectControl(id){
    const node=id==='STICK'?this.lever[1].node:this.buttons.find(b=>b.id===id)?.node;if(!node)return null;
    this.scene.updateMatrixWorld(true);this.pass.camera.updateMatrixWorld(true);
    const point=new Box3().setFromObject(node).getCenter(new Vector3()).project(this.pass.camera);const r=this.viewer.getBoundingClientRect();
    return {x:r.left+(point.x+1)*r.width/2,y:r.top+(1-point.y)*r.height/2};
  }
  snapshot(){
    return {active:this.active,mode:this.mode,power:this.power,buttons:this.buttons.map(b=>({id:b.id,depthMm:b.base.clone().sub(b.node.position).dot(b.normal),held:b.sources.size>0})),stick:{x:this.stickX.x,y:this.stickY.x,tiltDegrees:this.lever[0].quaternion.angleTo(this.lever[0].node.quaternion)*180/Math.PI},rgb:this.leds.filter(l=>!l.texture).slice(0,3).map(l=>l.material.emissive.toArray())};
  }
  dispose(){cancelAnimationFrame(this.frame);this.abort.abort();this.releaseAll();this.restore();for(const l of this.leds){l.texture?.dispose();l.material.dispose();l.mesh.material=l.originalMaterial;if(l.texture){l.mesh.geometry.dispose();l.mesh.geometry=l.originalGeometry;}}}
}
