import '@google/model-viewer';
import '@google/model-viewer-effects';
import {Arcade} from './arcade.js';
import {EnvironmentRotationPass} from './environment-pass.js';
import {BufferGeometry, CanvasTexture, CubicBezierCurve3, Float32BufferAttribute, Mesh, MeshStandardMaterial, SRGBColorSpace, Vector3} from 'three';
import {drawTab5} from './tab5-display.js';
import {bed, buildPrintLayout, disposePlate, plates} from './print-layout.js';
import simulation from './tilt-simulation.json';
import './style.css';

const viewer=document.querySelector('#viewer');
const controls=document.querySelector('#model-controls');
const stage=document.querySelector('.stage');
const status=document.querySelector('#load-status');
const assembly=document.querySelector('#assembly');
const plateControls=document.querySelector('#print-plate-controls');
const plateSelect=document.querySelector('#print-plate');
const annotations=document.querySelector('#print-annotations');
let annotationFrame=0;
const projectedPlateAnchor=new Vector3();
plateSelect.add(new Option('全6プレート','all'));
plates.forEach(({name},index)=>plateSelect.add(new Option(`${index+1} · ${name}`,String(index))));
let printMode=false, printPlate, plateRequest=0, assemblyVisibility=new Map();
let printAngle=[25,35];
const tilt=document.querySelector('#tab5-tilt');
const simAngle=document.querySelector('#sim-angle');
const simForce=document.querySelector('#sim-force');
const simLoad=document.querySelector('#sim-load');
const simRelease=document.querySelector('#sim-release');
const simStatus=document.querySelector('#sim-status');
let simFrame=0;

function indexPin(){
  return environmentPass.scene?.getObjectByName('PRINT tilt index pin');
}
function stopSimulation(){
  cancelAnimationFrame(simFrame);
  simFrame=0;
  simRelease.disabled=false;
  simStatus.textContent='';
  const pin=indexPin();
  if(pin&&!printMode)pin.visible=true;
}
function showLoad(){
  const result=simulation.locks.find(({angle,force})=>angle===Number(simAngle.value)&&force===Number(simForce.value));
  simLoad.textContent=`${result.pinLoad.toFixed(1)} N · 角度差 ${result.error.toFixed(3)}°`;
}
function showLockedPose(){
  assembly.value='0';
  setAssembly();
  tilt.value=simAngle.value;
  setTilt();
  showLoad();
}
function replayRelease(){
  assembly.value='0';
  setAssembly();
  const pin=indexPin();
  if(pin)pin.visible=false;
  setView('rear');
  if(matchMedia('(max-width: 700px)').matches)stage.scrollIntoView({block:'start'});
  simRelease.disabled=true;
  simStatus.textContent='角度ピンを外しました';
  const samples=simulation.release;
  const last=samples.length-1;
  const start=performance.now();
  let index=0;
  function frame(now){
    const elapsed=now-start;
    while(index<last&&samples[index+1][0]<=elapsed)index++;
    const [time,angle]=samples[index];
    if(index===last){
      applyTilt(angle,true);
      tilt.value=angle;
      simStatus.textContent=`自重で ${angle.toFixed(2)}° まで傾きました`;
      simFrame=0;
      simRelease.disabled=false;
      return;
    }
    const [nextTime,nextAngle]=samples[index+1];
    applyTilt(angle+(nextAngle-angle)*(elapsed-time)/(nextTime-time),true);
    simFrame=requestAnimationFrame(frame);
  }
  applyTilt(samples[0][1],true);
  simFrame=requestAnimationFrame(frame);
}
const exposure=document.querySelector('#exposure');
const environmentStrength=document.querySelector('#environment-strength');
const led=document.querySelector('#led');
const transparent=document.querySelector('#transparent');
const rotate=document.querySelector('#rotate');
const rotateView=document.querySelector('#rotate-view');
const environment=document.querySelector('#environment');
const environmentAngle=document.querySelector('#environment-angle');
const background=document.querySelector('#background');
const ssaoEnabled=document.querySelector('#ssao-enabled');
const ssao=document.querySelector('#ssao');
const ledBloom=document.querySelector('#led-bloom');
const composer=document.querySelector('#composer');
const environmentPass=new EnvironmentRotationPass();
composer.addPass(environmentPass);
const playMode=document.querySelector('#play-mode');
const playView=document.querySelector('#play-view');
const turbo=document.querySelector('#tab5-turbo');
const macro=document.querySelector('#tab5-macro');
const runMacroButton=document.querySelector('#run-macro');
const macroPresets={UIO:['B1','B2','B4'],JKL:['B3','B5','B6']};
const displayCanvas=document.createElement('canvas');
displayCanvas.width=1024;
displayCanvas.height=576;
const displayContext=displayCanvas.getContext('2d');
let displayTexture, macroTimers=[], displayInput={buttons:[],x:0,y:0};

const rgbMode=document.querySelector('#rgb-mode');const rgbColor=document.querySelector('#rgb-color');const rgbSpeed=document.querySelector('#rgb-speed');
const backgroundColor=document.querySelector('#background-color');const grid=document.querySelector('#grid');
const ssaoStrength=document.querySelector('#ssao-strength');const ssaoRadius=document.querySelector('#ssao-radius');
let arcade=null;
let gpioLoop;
const environmentSources={studio03:'./environments/studio_small_03_1k.hdr',studio02:'./environments/studio_small_02_1k.hdr',neutral:'neutral'};
const viewButtons=[...document.querySelectorAll('[data-view]')];
const viewAngles={hero:[25,65],front:[0,90],right:[90,90],rear:[165,84],gpio:[165,106],top:[0,.1]};
let ready=false,restTarget,restRadius,emissive=[],caseMaterials=[];
let view='hero';

function frameCurrentView(){
  if(!ready)return;
  if(printMode){
    const [theta,phi]=printAngle;
    const overview=plateSelect.value==='all';
    const distance=innerWidth<700?(overview?2.7:1.25):(overview?2.45:1.16);
    viewer.cameraOrbit=`${theta}deg ${phi}deg ${distance}m`;
    viewer.cameraTarget='0m 0m 0m';
    return;
  }
  const fraction=Number(assembly.value)/100;
  const [theta,phi]=viewAngles[view];
  if(view==='gpio'){
    viewer.cameraOrbit=`${theta}deg ${phi}deg ${restRadius*.68}m`;
    viewer.cameraTarget=`-0.038m ${.070+.115*fraction}m -0.096m`;
    return;
  }
  viewer.cameraOrbit=`${theta}deg ${phi}deg ${restRadius*(1+.45*fraction)}m`;
  viewer.cameraTarget=`${restTarget.x}m ${restTarget.y+.028*fraction}m ${restTarget.z}m`;
}
function setView(name){
  if(printMode)printAngle=viewAngles[name];
  else view=name;
  viewButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===name)));
  frameCurrentView();
}
function clearPrintAnnotations(){
  cancelAnimationFrame(annotationFrame);
  annotations.hidden=true;
  annotations.replaceChildren();
}
function showPrintAnnotations(group){
  const groups=group.name==='NC04PrintLayout'?group.children:[group];
  const labels=groups.map(plate=>{
    const index=plate.userData.plateIndex;
    const spec=plates[index];
    const minutes=Math.round(spec.seconds/60);
    const duration=minutes>=60?`${Math.floor(minutes/60)}時間${minutes%60}分`:`${minutes}分`;
    const tag=document.createElement('div');
    const title=document.createElement('strong');
    const details=document.createElement('span');
    tag.className='print-annotation';
    title.textContent=`${index+1} · ${spec.name}`;
    details.textContent=`${spec.translucent?'乳白・半透明 PLA':'白PLA'} · 約${duration}`;
    tag.append(title,details);
    annotations.append(tag);
    return {plate,tag};
  });
  annotations.hidden=false;
  function positionLabels(){
    const camera=environmentPass.camera;
    if(!printMode||!camera)return;
    camera.updateMatrixWorld(true);
    const viewport=viewer.getBoundingClientRect();
    const stageBounds=stage.getBoundingClientRect();
    for(const {plate,tag} of labels){
      projectedPlateAnchor.set(0,2,bed.depth*.42);
      plate.localToWorld(projectedPlateAnchor).project(camera);
      const {x,y,z}=projectedPlateAnchor;
      tag.hidden=z<-1||z>1||Math.abs(x)>1||Math.abs(y)>1;
      tag.style.left=`${viewport.left-stageBounds.left+(x+1)*viewport.width/2}px`;
      tag.style.top=`${viewport.top-stageBounds.top+(1-y)*viewport.height/2}px`;
    }
    annotationFrame=requestAnimationFrame(positionLabels);
  }
  annotationFrame=requestAnimationFrame(positionLabels);
}
async function renderPrintPlate(){
  const request=++plateRequest;
  clearPrintAnnotations();
  if(printPlate){disposePlate(printPlate);printPlate=null;}
  status.textContent='造形プレートを読み込み中…';
  try{
    const selection=plateSelect.value;
    const group=await buildPrintLayout(selection,innerWidth<700?2:3);
    if(!printMode||request!==plateRequest){disposePlate(group);return;}
    const root=environmentPass.scene?.getObjectByName('NULL_CITY_meters');
    if(!root){disposePlate(group);return;}
    printPlate=group;
    root.add(group);
    showPrintAnnotations(group);
    status.textContent=selection==='all'?'造形配置 · 全6プレート':`造形配置 · プレート ${Number(selection)+1}`;
    environmentPass.scene.queueShadowRender?.();
    composer.queueRender();
  }catch{
    if(printMode&&request===plateRequest)status.textContent='造形プレートを読み込めませんでした';
  }
}
function setPrintMode(active){
  if(printMode===active)return;
  printMode=active;
  plateControls.hidden=!active;
  stage.dataset.print=String(active);
  viewer.maxCameraOrbit=active?'auto 170deg 4m':'auto 170deg 250%';
  const root=environmentPass.scene?.getObjectByName('NULL_CITY_meters');
  if(active&&root){
    printAngle=plateSelect.value==='all'?[0,20]:[25,35];
    assemblyVisibility=new Map(root.children.map(child=>[child,child.visible]));
    for(const child of assemblyVisibility.keys())child.visible=false;
    renderPrintPlate();
  }else if(!active){
    ++plateRequest;
    clearPrintAnnotations();
    if(printPlate){disposePlate(printPlate);printPlate=null;}
    for(const [child,visible] of assemblyVisibility)child.visible=visible;
    assemblyVisibility.clear();
    status.textContent='ドラッグして操作できます';
    viewButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
  }
  environmentPass.scene?.queueShadowRender?.();
  composer.queueRender();
}
function setAssembly(){
  stopSimulation();
  const value=Number(assembly.value);
  const fraction=Math.min(1,value/100);
  const printing=value>100;
  const output=printing?'造形配置':`${value}%`;
  document.querySelector('#assembly-value').value=output;
  assembly.setAttribute('aria-valuetext',printing?output:`分解 ${output}`);
  if(!ready)return;
  if(fraction>0&&arcade?.active){playMode.checked=false;setPlayMode();}
  viewer.pause();viewer.currentTime=Math.min(viewer.duration-.0001,Math.max(0,viewer.duration*fraction));
  setPrintMode(printing);
  frameCurrentView();
  updateGpioLoop();
}
function setTilt(){
  stopSimulation();
  applyTilt(Number(tilt.value));
}
function applyTilt(degrees, simulated=false){
  document.querySelector('#tab5-tilt-value').value=`${simulated?degrees.toFixed(2):degrees}°`;
  const pivot=environmentPass.scene?.getObjectByName('Tab5TiltPivot');
  if(!pivot)return;
  pivot.rotation.x=-degrees*Math.PI/180;
  pivot.updateMatrixWorld(true);
  updateGpioLoop();
  environmentPass.scene.queueShadowRender?.();
  composer.queueRender();
}
function ribbonGeometry(curve,width,thickness){
  const divisions=40;
  const positions=[];
  const indices=[3,2,1,3,1,0];
  const across=new Vector3(width/2,0,0);
  for(let step=0;step<=divisions;step++){
    const point=curve.getPoint(step/divisions);
    const depth=curve.getTangent(step/divisions).cross(across).normalize().multiplyScalar(thickness/2);
    for(const [side,face] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
      positions.push(...point.clone().addScaledVector(across,side).addScaledVector(depth,face));
    }
    if(step===divisions)continue;
    const offset=step*4;
    for(let side=0;side<4;side++){
      const a=offset+side, b=offset+(side+1)%4;
      indices.push(a,b,b+4,a,b+4,a+4);
    }
  }
  const end=divisions*4;
  indices.push(end,end+1,end+2,end,end+2,end+3);
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
function updateGpioLoop(){
  const root=environmentPass.scene?.getObjectByName('NULL_CITY_meters');
  const moving=root?.getObjectByName('GpioCableStart');
  const fixed=root?.getObjectByName('GpioCableEntry');
  if(!moving||!fixed)return;
  if(Number(assembly.value)>0){
    if(gpioLoop)gpioLoop.visible=false;
    return;
  }
  const from=root.worldToLocal(moving.getWorldPosition(new Vector3()));
  const to=root.worldToLocal(fixed.getWorldPosition(new Vector3()));
  const curve=new CubicBezierCurve3(from,from.clone().add(new Vector3(0,-4,-24)),
    to.clone().add(new Vector3(0,0,-22)),to);
  const geometry=ribbonGeometry(curve,moving.userData.ribbon_width_mm,moving.userData.ribbon_thickness_mm);
  if(!gpioLoop||gpioLoop.parent!==root){
    gpioLoop?.geometry.dispose();
    gpioLoop?.material.dispose();
    gpioLoop=new Mesh(geometry,new MeshStandardMaterial({color:0x7a8189,roughness:.68}));
    gpioLoop.name='GPIO flat ribbon service loop';
    root.add(gpioLoop);
  }else{
    gpioLoop.geometry.dispose();
    gpioLoop.geometry=geometry;
  }
  gpioLoop.visible=true;
  composer.queueRender();
}
function setLights(){
  for(const {material,factor} of emissive)material.setEmissiveFactor(led.checked?factor:[0,0,0]);
  arcade?.setPower(led.checked);
  ledBloom.blendMode=led.checked&&ledBloom.selection.length?'DEFAULT':'SKIP';
}
function selectLEDMeshes(){
  const names=new Set(emissive.map(({material})=>material.name));
  ledBloom.selection=[...composer.selection.values()].filter(mesh=>{
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    return materials.some(material=>names.has(material?.name));
  });
  setLights();
}
composer.addEventListener('updated-selection',selectLEDMeshes);
function setTransparency(){
  for(const {material,color,alpha,doubleSided} of caseMaterials){
    material.setAlphaMode(transparent.checked?'BLEND':alpha);
    material.setDoubleSided(transparent.checked||doubleSided);
    material.pbrMetallicRoughness.setBaseColorFactor([...color.slice(0,3),transparent.checked?.18:color[3]]);
  }
}
function setEnvironmentStrength(){
  environmentPass.intensity=Number(environmentStrength.value);
  document.querySelector('#environment-strength-value').value=`${Number(environmentStrength.value).toFixed(1)}×`;
  composer.queueRender();
}
function setExposure(){
  const ev=Number(exposure.value);
  viewer.exposure=.8*2**ev;
  document.querySelector('#exposure-value').value=`${ev>=0?'+':''}${ev.toFixed(1)} EV`;
}
function setRotation(){
  // Start immediately and at a visible speed; on mobile the switch can be below the viewport.
  if(rotate.checked&&arcade?.active){playMode.checked=false;setPlayMode();}
  viewer.autoRotateDelay=0;viewer.rotationPerSecond='20deg';viewer.autoRotate=rotate.checked;
  rotateView.setAttribute('aria-pressed',String(rotate.checked));
  if(rotate.checked){
    // A touch change is followed by native focus scrolling. Wait until that completes;
    // smooth scrolling here can be cancelled by the focus scroll on mobile Chromium.
    requestAnimationFrame(()=>{
      const rect=viewer.getBoundingClientRect();
      if(rect.bottom<100||rect.top>innerHeight-100)viewer.scrollIntoView({block:'center',behavior:'instant'});
    });
  }
}
function setEnvironmentAngle(){
  environmentPass.angle=Number(environmentAngle.value);
  document.querySelector('#environment-angle-value').value=`${environmentAngle.value}°`;
  composer.queueRender();
}
function setBackground(){viewer.skyboxImage=background.checked&&environment.value!=='neutral'?environmentSources[environment.value]:null;}
function setEnvironment(){
  const source=environmentSources[environment.value];
  if(viewer.environmentImage!==source){stage.dataset.environmentLoading='true';status.textContent='HDR環境を読み込み中…';}
  viewer.environmentImage=source;
  background.disabled=environment.value==='neutral';
  if(background.disabled)background.checked=false;
  const credit=document.querySelector('#environment-credit a');
  credit.href=environment.value==='studio02'?'https://polyhaven.com/a/studio_small_02':'https://polyhaven.com/a/studio_small_03';
  document.querySelector('#environment-credit').hidden=environment.value==='neutral';
  setBackground();setEnvironmentAngle();
}
function setSSAO(){
  ssao.blendMode=ssaoEnabled.checked?'DEFAULT':'SKIP';
  ssao.strength=Number(ssaoStrength.value);
  const effect=ssao.effects[0];
  effect.luminanceInfluence=.15;
  effect.ssaoMaterial.bias=.0015;
  effect.ssaoMaterial.fade=.003;
  effect.ssaoMaterial.radius=Number(ssaoRadius.value)/100;
  document.querySelector('#ssao-strength-value').value=Number(ssaoStrength.value).toFixed(1);
  document.querySelector('#ssao-radius-value').value=`${Number(ssaoRadius.value)}%`;
  ssaoStrength.disabled=ssaoRadius.disabled=!ssaoEnabled.checked;composer.queueRender();
}
function setRGB(){
  arcade?.configure(rgbMode.value,rgbSpeed.value,rgbColor.value);
  document.querySelector('#rgb-speed-value').value=`${Number(rgbSpeed.value).toFixed(1)}×`;
}
function setBackgroundColor(disableHDR=true){
  const hex=backgroundColor.value;stage.style.setProperty('--stage-background',hex);stage.style.backgroundColor=hex;
  const n=parseInt(hex.slice(1),16);const luma=.2126*(n>>16)+.7152*((n>>8)&255)+.0722*(n&255);
  stage.dataset.backgroundTheme=luma<110?'dark':'light';stage.dataset.grid=String(grid.checked);
  if(disableHDR){background.checked=false;setBackground();}
}
function refreshTab5(){
  if(!displayTexture)return;
  drawTab5(displayContext,{...displayInput,turbo:turbo.checked,macro:macro.value,running:runMacroButton.disabled});
  displayTexture.needsUpdate=true;
  composer.queueRender();
}
function bindTab5Display(){
  const screen=environmentPass.scene?.getObjectByName('Tab5DisplaySurface');
  if(!screen?.material)return;
  displayTexture?.dispose();
  displayTexture=new CanvasTexture(displayCanvas);
  displayTexture.colorSpace=SRGBColorSpace;
  displayTexture.flipY=false;
  screen.material.map=displayTexture;
  screen.material.emissiveMap=displayTexture;
  screen.material.emissive.setRGB(1,1,1);
  screen.material.emissiveIntensity=.85;
  screen.material.needsUpdate=true;
  refreshTab5();
}
function stopMacro(){
  for(const timer of macroTimers)clearTimeout(timer);
  macroTimers=[];
  for(const key of macroPresets[macro.value])arcade?.press(key,false,'macro');
  runMacroButton.disabled=false;
  macro.disabled=false;
  refreshTab5();
}
function runMacro(){
  if(!arcade?.active||macroTimers.length)return;
  runMacroButton.disabled=true;
  macro.disabled=true;
  macroPresets[macro.value].forEach((key,index)=>{
    macroTimers.push(setTimeout(()=>arcade?.press(key,true,'macro'),index*200));
    macroTimers.push(setTimeout(()=>arcade?.press(key,false,'macro'),index*200+120));
  });
  macroTimers.push(setTimeout(stopMacro,600));
  refreshTab5();
}
function setPlayMode(){
  if(!ready){playMode.checked=false;return;}
  const active=playMode.checked;
  if(active){
    rotate.checked=false;setRotation();viewer.resetTurntableRotation(0);
    assembly.value='0';setAssembly();setView('hero');viewer.jumpCameraToGoal();
  }
  if(!active)stopMacro();
  arcade?.setActive(active);viewer.cameraControls=!active;viewer.style.touchAction=active?'none':'pan-y';
  playView.setAttribute('aria-pressed',String(active));playView.textContent=active?'視点を動かす':'操作する';
  stage.dataset.play=String(active);document.querySelector('#play-controls').hidden=!active;
  document.querySelector('#interaction-hint').innerHTML=active?'<span>レバーをドラッグ</span><span>ボタンを押す</span><span>WASD / 矢印 · UIO / JKL</span>':'<span>ドラッグで回転</span><span>スクロールでズーム</span><span>右ドラッグで移動</span>';
  if(active)viewer.focus({preventScroll:true});
}
function reportInput({buttons,x,y}){
  displayInput={buttons,x,y};
  refreshTab5();
  const arrows=Math.hypot(x,y)<.2?'':[['→','↗','↑','↖','←','↙','↓','↘'][(Math.round(Math.atan2(y,x)*4/Math.PI)+8)%8]];
  document.querySelector('#input-readout').value=`入力：${[arrows,...buttons].filter(Boolean).join(' + ')||'—'}`;
  document.querySelectorAll('[data-arcade-control]').forEach(button=>button.dataset.pressed=String(buttons.includes(button.dataset.arcadeControl)));
}
viewer.addEventListener('environment-change',()=>{
  requestAnimationFrame(()=>{
    setEnvironmentAngle();stage.dataset.environmentLoading='false';stage.dataset.environment=environment.value;
    if(ready&&!printMode)status.textContent='ドラッグして操作できます';
  });
});
function reset(){
  playMode.checked=false;setPlayMode();
  turbo.checked=false;macro.value='UIO';arcade?.setTurbo(false);refreshTab5();
  rgbMode.value=matchMedia('(prefers-reduced-motion: reduce)').matches?'solid':'rainbow';rgbColor.value='#00a6cf';rgbSpeed.value='1';
  backgroundColor.value='#e9e9e7';grid.checked=true;ssaoStrength.value='1.2';ssaoRadius.value='5';
  assembly.value='0';plateSelect.value='all';tilt.value='30';exposure.value='0';environmentStrength.value='1';led.checked=true;transparent.checked=false;rotate.checked=false;
  environment.value='studio03';environmentAngle.value='90';background.checked=false;ssaoEnabled.checked=true;
  setAssembly();setTilt();setEnvironmentStrength();setExposure();setLights();setTransparency();setRotation();setView('hero');
  viewer.resetTurntableRotation(0);setEnvironment();setSSAO();setRGB();setBackgroundColor(false);
}

viewer.addEventListener('progress',event=>{document.querySelector('#progress').value=event.detail.totalProgress;});
viewer.addEventListener('load',()=>{
  ready=true;controls.disabled=false;stage.dataset.loaded='true';status.textContent='ドラッグして操作できます';
  document.querySelector('#error-panel').hidden=true;
  restTarget=viewer.getCameraTarget();restRadius=viewer.getCameraOrbit().radius;
  emissive=viewer.model.materials.filter(material=>material.name!=='Tab5 HUD display'&&material.emissiveFactor.some(value=>value>0)).map(material=>({material,factor:[...material.emissiveFactor]}));
  const ledStrengths={'Backlit translucent PLA illustration':5,'Magenta lighting illustration':5,'Indicator LED RGB':4,'Cool white lettering':3};
  for(const {material} of emissive){if(ledStrengths[material.name])material.setEmissiveStrength(ledStrengths[material.name]);}
  selectLEDMeshes();
  caseMaterials=viewer.model.materials.filter(material=>material.name==='NC-04 white PLA').map(material=>({material,color:[...material.pbrMetallicRoughness.baseColorFactor],alpha:material.getAlphaMode(),doubleSided:material.getDoubleSided()}));
  viewer.animationName='Assembly';viewer.pause();viewer.currentTime=0;reset();
  arcade?.dispose();arcade=new Arcade(viewer,composer,environmentPass,reportInput);viewer.arcade=arcade;
  bindTab5Display();setRGB();setLights();selectLEDMeshes();
});
viewer.addEventListener('error',()=>{
  ready=false;controls.disabled=true;status.textContent='読み込みエラー';document.querySelector('#error-panel').hidden=false;
});
turbo.addEventListener('change',()=>{arcade?.setTurbo(turbo.checked);refreshTab5();});
macro.addEventListener('change',refreshTab5);
runMacroButton.addEventListener('click',runMacro);
window.addEventListener('blur',stopMacro);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMacro();});
assembly.addEventListener('input',setAssembly);
plateSelect.addEventListener('change',()=>{
  if(!printMode)return;
  printAngle=plateSelect.value==='all'?[0,20]:[25,35];
  frameCurrentView();
  renderPrintPlate();
});
tilt.addEventListener('input',setTilt);
simAngle.addEventListener('change',showLockedPose);
simForce.addEventListener('change',showLoad);
simRelease.addEventListener('click',replayRelease);
showLoad();
exposure.addEventListener('input',setExposure);
environmentStrength.addEventListener('input',setEnvironmentStrength);
led.addEventListener('change',setLights);
transparent.addEventListener('change',setTransparency);
rotate.addEventListener('change',setRotation);
rotateView.addEventListener('click',()=>{if(ready){rotate.checked=!rotate.checked;setRotation();}});
environment.addEventListener('change',setEnvironment);
environmentAngle.addEventListener('input',setEnvironmentAngle);
background.addEventListener('change',setBackground);
ssaoEnabled.addEventListener('change',setSSAO);
ssaoStrength.addEventListener('input',setSSAO);ssaoRadius.addEventListener('input',setSSAO);
playMode.addEventListener('change',setPlayMode);playView.addEventListener('click',()=>{playMode.checked=!playMode.checked;setPlayMode();});
for(const input of [rgbMode,rgbColor,rgbSpeed])input.addEventListener(input===rgbMode?'change':'input',setRGB);
backgroundColor.addEventListener('input',()=>setBackgroundColor());grid.addEventListener('change',()=>setBackgroundColor(false));
document.querySelectorAll('[data-background]').forEach(button=>button.addEventListener('click',()=>{backgroundColor.value=button.dataset.background;setBackgroundColor();}));
for(const button of document.querySelectorAll('[data-arcade-control],[data-direction]')){
  const update=(down,source)=>{
    if(button.dataset.arcadeControl)arcade?.press(button.dataset.arcadeControl,down,source);
    else arcade?.pad(button.dataset.direction.split(',').map(Number),down,source);
  };
  button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);update(true,`pad:${event.pointerId}`);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,event=>update(false,`pad:${event.pointerId}`));
  button.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();if(!event.repeat)update(true,`pad-key:${button.dataset.arcadeControl??button.dataset.direction}`);}});
  button.addEventListener('blur',()=>update(false,`pad-key:${button.dataset.arcadeControl??button.dataset.direction}`));
  button.addEventListener('keyup',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();update(false,`pad-key:${button.dataset.arcadeControl??button.dataset.direction}`);}});
}
viewButtons.forEach(button=>button.addEventListener('click',()=>{
  if(!ready)return;
  const destination=button.dataset.view;
  setView(destination);
  if(destination==='gpio'&&stage.getBoundingClientRect().bottom<innerHeight*.5){
    stage.scrollIntoView({block:'start',behavior:'instant'});
  }
}));
const viewShortcuts={KeyZ:'hero',KeyX:'front',KeyC:'right',KeyV:'rear',KeyB:'top'};
window.addEventListener('keydown',event=>{
  if(!ready||event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||event.isComposing)return;
  if(event.target.closest?.('input,select,textarea,[contenteditable]:not([contenteditable=false])'))return;
  const view=viewShortcuts[event.code];
  if(view){
    event.preventDefault();
    if(!event.repeat)setView(view);
  }else if(event.code==='Space'&&(event.target===viewer||!event.target.closest?.('button,summary,[role=button]'))){
    event.preventDefault();
    event.stopPropagation();
    if(!event.repeat){
      assembly.value=Number(assembly.value)>0?'0':'100';
      setAssembly();
    }
  }
},{capture:true});
document.querySelector('#reset').addEventListener('click',reset);
document.querySelector('#retry').addEventListener('click',()=>window.location.reload());
document.querySelector('#controls').addEventListener('submit',event=>event.preventDefault());
// Keep all initial controls deterministic; motion only starts when the user enables it.
fetch('./project/build.json').then(response=>{if(!response.ok)throw new Error('No build metadata');return response.json();}).then(data=>{document.querySelector('#revision').textContent=`MODEL / ${data.model.slice(0,8).toUpperCase()}`;}).catch(()=>{});
