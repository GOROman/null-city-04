import {test,expect} from '@playwright/test';

async function load(page,{freezeRGB=true}={}){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('.stage')).toHaveAttribute('data-loaded','true',{timeout:45000});
  await expect(page.locator('#error-panel')).toBeHidden();
  await expect(page.locator('.stage')).toHaveAttribute('data-environment','studio03',{timeout:45000});
  if(freezeRGB){await page.locator('#rgb-mode').selectOption('solid');await page.locator('#viewer').scrollIntoViewIfNeeded();}
  expect(errors).toEqual([]);
  return errors;
}

test('PBR model, meter scale, artwork, camera and assembly controls',async({page},testInfo)=>{
  const errors=await load(page);
  const model=await page.locator('#viewer').evaluate(v=>({size:v.getDimensions(),animations:v.availableAnimations,materials:v.model.materials.map(m=>m.name)}));
  expect(model.size.x).toBeCloseTo(.3,3);expect(model.size.z).toBeCloseTo(.2234,3);
  expect(model.animations).toEqual(['Assembly']);
  expect(model.materials).toContain('Tab5 rear • M5Stack reference photograph');
  await page.locator('.hardware-details summary').click();
  await expect(page.locator('.hardware-details')).toContainText('M3 × 40 mm × 4本');
  await expect(page.locator('.hardware-details')).toContainText('M3 熱圧入インサート');
  await expect(page.locator('.hardware-details')).toContainText('下向き 2 × 5 ピン');
  const gpioView=page.getByRole('button',{name:'下側の GPIO 端子を見る'});
  await gpioView.click();
  await expect(gpioView).toHaveAttribute('aria-pressed','true');
  const readTilt=()=>page.locator('#viewer').evaluate(v=>v.arcade.scene.getObjectByName('Tab5TiltPivot').rotation.x);
  await expect.poll(readTilt).toBeCloseTo(-Math.PI/6,3);
  const ribbonStart=()=>page.locator('#viewer').evaluate(v=>{
    const points=v.arcade.scene.getObjectByName('GPIO flat ribbon service loop')?.geometry.getAttribute('position');
    return points&&{width:points.getX(1)-points.getX(0),depth:Math.hypot(
      points.getY(2)-points.getY(1),points.getZ(2)-points.getZ(1)),start:points.getY(0)};
  });
  await expect.poll(async()=> (await ribbonStart())?.width).toBeCloseTo(12.7,3);
  const initialCable=await ribbonStart();
  expect(initialCable.depth).toBeCloseTo(.9,3);
  await page.locator('#tab5-tilt').evaluate(e=>{e.value='45';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#tab5-tilt-value')).toHaveText('45°');
  await expect.poll(readTilt).toBeCloseTo(-Math.PI/4,3);
  expect((await ribbonStart()).start).not.toBeCloseTo(initialCable.start,2);
  await page.locator('#viewer').focus();
  for(const [key,view] of [['X','front'],['C','right'],['V','rear'],['B','top'],['Z','hero']]){
    await page.keyboard.press(key);
    await expect(page.locator(`[data-view=${view}]`)).toHaveAttribute('aria-pressed','true');
  }
  await page.keyboard.press('Space');
  await expect(page.locator('#assembly-value')).toHaveText('100%');
  await page.keyboard.press('Space');
  await expect(page.locator('#assembly-value')).toHaveText('0%');
  await page.getByRole('button',{name:'右側面',exact:true}).click();
  await expect(page.getByRole('button',{name:'右側面',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('#assembly').evaluate(e=>{e.value='100';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#assembly-value')).toHaveText('100%');
  const pose=await page.locator('#viewer').evaluate(v=>({time:v.currentTime,duration:v.duration}));
  expect(pose.time).toBeGreaterThan(.9*pose.duration);
  await expect.poll(readTilt).toBeCloseTo(-Math.PI/4,3);
  await page.locator('#assembly').evaluate(e=>{e.value='200';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#assembly-value')).toHaveText('造形配置');
  await expect(page.locator('#print-plate option')).toHaveCount(7);
  await expect(page.locator('#load-status')).toHaveText('造形配置 · 全6プレート');
  const overview=await page.locator('#viewer').evaluate(v=>{
    const groups=v.arcade.scene.getObjectByName('NC04PrintLayout').children;
    return {plates:groups.length,parts:groups.reduce((n,group)=>n+group.userData.partCount,0),
      positions:new Set(groups.map(group=>group.position.toArray().join(','))).size};
  });
  expect(overview).toEqual({plates:6,parts:15,positions:6});
  await page.locator('#print-plate').selectOption('3');
  await expect(page.locator('#load-status')).toHaveText('造形配置 · プレート 4');
  const plate=await page.locator('#viewer').evaluate(v=>{
    const group=v.arcade.scene.getObjectByName('NC04PrintPlate');
    const tablet=v.arcade.scene.getObjectByName('Tab5TiltPivot');
    return {parts:group.userData.partCount,tabletVisible:tablet.visible};
  });
  expect(plate).toEqual({parts:3,tabletVisible:false});
  await page.locator('#assembly').evaluate(e=>{e.value='100';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#print-plate-controls')).toBeHidden();
  expect(await page.locator('#viewer').evaluate(v=>v.arcade.scene.getObjectByName('Tab5TiltPivot').visible)).toBe(true);
  await page.locator('#led').uncheck({force:true});
  expect(await page.locator('#viewer').evaluate(v=>v.model.materials.filter(m=>m.name!=='Tab5 HUD display').every(m=>m.emissiveFactor.every(x=>x===0)))).toBe(true);
  await page.locator('#transparent').check({force:true});
  expect(await page.locator('#viewer').evaluate(v=>v.model.materials.find(m=>m.name==='NC-04 white PLA').pbrMetallicRoughness.baseColorFactor[3])).toBeCloseTo(.18,2);
  await page.locator('#exposure').evaluate(e=>{e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#exposure-value')).toHaveText('+1.0 EV');
  expect(await page.locator('#viewer').evaluate(v=>v.exposure)).toBeCloseTo(1.6,4);
  await page.locator('#rotate').check({force:true});
  expect(await page.locator('#viewer').evaluate(v=>v.autoRotate)).toBe(true);
  expect(await page.locator('#viewer').evaluate(v=>v.autoRotateDelay)).toBe(0);
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>v.modelIsVisible),{timeout:8000}).toBe(true);
  const initialAngle=await page.locator('#viewer').evaluate(v=>v.turntableRotation);
  if(process.env.CI)console.log('Rotation start',await page.evaluate(()=>({
    dpr:devicePixelRatio,visibility:document.visibilityState,
    modelVisible:document.querySelector('#viewer').modelIsVisible,
    autoRotate:document.querySelector('#viewer').autoRotate,
    renderCount:document.querySelector('#composer').userPasses[0].scene.renderCount,
  })));
  await expect.poll(()=>page.locator('#viewer').evaluate((v,initial)=>Math.abs(v.turntableRotation-initial),initialAngle),{timeout:8000}).toBeGreaterThan(.05);
  await page.locator('#rotate').uncheck({force:true});
  await page.locator('#viewer').scrollIntoViewIfNeeded();
  const stoppedAngle=await page.locator('#viewer').evaluate(v=>v.turntableRotation);
  await page.waitForTimeout(400);
  expect(await page.locator('#viewer').evaluate((v,angle)=>Math.abs(v.turntableRotation-angle),stoppedAngle)).toBeLessThan(.002);
  await page.getByRole('button',{name:'視点と表示設定をリセット'}).click();
  await expect(page.locator('#assembly-value')).toHaveText('0%');
  await page.locator('#environment').selectOption('studio02');
  await expect(page.locator('.stage')).toHaveAttribute('data-environment','studio02',{timeout:45000});
  await expect.poll(()=>page.locator('#composer').evaluate(c=>c.userPasses[0].scene?.environment?.name),{timeout:15000}).toContain('studio_small_02_1k.hdr');
  await page.locator('#environment-angle').evaluate(e=>{e.value='180';e.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(await page.locator('#composer').evaluate(c=>c.userPasses[0].scene.environmentRotation.y)).toBeCloseTo(Math.PI,4);
  await expect(page.locator('#environment-angle-value')).toHaveText('180°');
  await page.locator('#background').check({force:true});
  expect(await page.locator('#viewer').evaluate(v=>v.skyboxImage)).toContain('studio_small_02_1k.hdr');
  await page.locator('#ssao-enabled').uncheck({force:true});
  await expect.poll(()=>page.locator('#ssao').evaluate(e=>e.effects[0].disabled)).toBe(true);
  await page.locator('#ssao-enabled').check({force:true});
  await expect.poll(()=>page.locator('#ssao').evaluate(e=>e.effects[0].disabled)).toBe(false);
  await page.getByRole('button',{name:'視点と表示設定をリセット'}).click();
  await expect(page.locator('.stage')).toHaveAttribute('data-environment','studio03',{timeout:45000});
  await expect(page.locator('#led')).toBeChecked();await expect(page.locator('#rotate')).not.toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('.wordmark')).toHaveCSS('font-family',/Null/);
  await page.getByRole('button',{name:'自動回転を切り替える'}).click();
  await expect(page.locator('#rotate')).toBeChecked();
  const overlayAngle=await page.locator('#viewer').evaluate(v=>v.turntableRotation);
  await expect.poll(()=>page.locator('#viewer').evaluate((v,initial)=>Math.abs(v.turntableRotation-initial),overlayAngle),{timeout:8000}).toBeGreaterThan(.05);
  await page.getByRole('button',{name:'自動回転を切り替える'}).click();
  await expect(page.locator('#rotate')).not.toBeChecked();
  await page.waitForTimeout(1200);
  await page.screenshot({path:testInfo.outputPath('viewer.png'),fullPage:true});
  expect(errors).toEqual([]);
});

test('failed model request shows an actionable error instead of an endless loader',async({page})=>{
  await page.route('**/model/nc04.glb',route=>route.abort());
  await page.goto('./');
  await expect(page.locator('#error-panel')).toBeVisible({timeout:30000});
  await expect(page.getByRole('button',{name:'再読み込み',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:/GLBをダウンロード/})).toBeVisible();
});

async function changeAndRender(page,change){
  await page.locator('#viewer').scrollIntoViewIfNeeded();
  const count=await page.locator('#composer').evaluate(c=>c.userPasses[0].scene.renderCount);
  await change();
  await expect.poll(()=>page.locator('#composer').evaluate(c=>c.userPasses[0].scene.renderCount),{timeout:20000}).toBeGreaterThan(count);
}
async function luminance(page){
  return page.locator('#viewer').evaluate(async v=>{
    const bitmap=await createImageBitmap(await v.toBlob({mimeType:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();
    const {data}=context.getImageData(0,0,canvas.width,canvas.height);
    let total=0,count=0;
    for(let i=0;i<data.length;i+=4){if(data[i+3]>128){total+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];count++;}}
    return total/Math.max(1,count);
  });
}

test('EV changes rendered brightness and LED emission survives without IBL',async({page})=>{
  await load(page);
  await expect.poll(()=>page.locator('#led-bloom').evaluate(e=>e.effects[0].selection.size),{timeout:10000}).toBeGreaterThan(3);
  await page.locator('#viewer').scrollIntoViewIfNeeded();
  await changeAndRender(page,()=>page.locator('#composer').evaluate(c=>c.queueRender()));
  const normal=await luminance(page);
  await changeAndRender(page,()=>page.locator('#exposure').evaluate(e=>{e.value='-1';e.dispatchEvent(new Event('input',{bubbles:true}));}));
  await expect(page.locator('#exposure-value')).toHaveText('-1.0 EV');
  expect(await page.locator('#viewer').evaluate(v=>v.exposure)).toBeCloseTo(.4,4);
  const dim=await luminance(page);
  expect(normal).toBeGreaterThan(10);expect(dim).toBeLessThan(normal*.95);
  await changeAndRender(page,()=>page.evaluate(()=>{
    const slider=document.querySelector('#exposure');slider.value='0';slider.dispatchEvent(new Event('input',{bubbles:true}));
    const strength=document.querySelector('#environment-strength');strength.value='0';strength.dispatchEvent(new Event('input',{bubbles:true}));
  }));
  await expect(page.locator('#environment-strength-value')).toHaveText('0.0×');
  const emitting=await luminance(page);
  await changeAndRender(page,()=>page.locator('#led').evaluate(e=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}));
  const off=await luminance(page);
  expect(emitting).toBeGreaterThan(off+2);
  await expect.poll(()=>page.locator('#led-bloom').evaluate(e=>e.effects[0].disabled)).toBe(true);
  console.log('Rendered luminance',{normal,minusOneEV:dim,noIBLWithLED:emitting,noIBLWithoutLED:off});
});


test('RGB animation, spring controls, background color and SSAO tuning',async({page})=>{
  const errors=await load(page,{freezeRGB:false});
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>Boolean(v.arcade))).toBe(true);
  const first=await page.locator('#viewer').evaluate(v=>v.arcade.snapshot().rgb[0]);
  await expect.poll(()=>page.locator('#viewer').evaluate((v,first)=>v.arcade.snapshot().rgb[0].reduce((sum,value,i)=>sum+Math.abs(value-first[i]),0),first),{timeout:10000}).toBeGreaterThan(.08);
  await page.locator('#rgb-mode').selectOption('solid');
  await page.getByRole('button',{name:'背景をダークに',exact:true}).click();
  await expect(page.locator('.stage')).toHaveAttribute('data-background-theme','dark');
  await expect(page.locator('#background-color')).toHaveValue('#17171c');
  await page.locator('#ssao-strength').evaluate(e=>{e.value='2.1';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#ssao-radius').evaluate(e=>{e.value='12';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#ssao-strength-value')).toHaveText('2.1');await expect(page.locator('#ssao-radius-value')).toHaveText('12%');
  expect(await page.locator('#ssao').evaluate(e=>e.effects[0].ssaoMaterial.radius)).toBeCloseTo(.12,4);
  await page.locator('#play-view').click();
  await expect(page.locator('.stage')).toHaveAttribute('data-play','true');
  expect(await page.locator('#viewer').evaluate(v=>v.cameraControls)).toBe(false);
  await page.keyboard.down('KeyU');
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>v.arcade.snapshot().buttons[0].depthMm)).toBeGreaterThan(1);
  await page.keyboard.up('KeyU');
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>Math.abs(v.arcade.snapshot().buttons[0].depthMm)),{timeout:4000}).toBeLessThan(.05);
  await page.keyboard.down('ArrowRight');
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>v.arcade.snapshot().stick.tiltDegrees)).toBeGreaterThan(10);
  await page.keyboard.up('ArrowRight');
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>v.arcade.snapshot().stick.tiltDegrees),{timeout:4000}).toBeLessThan(.2);
  const point=await page.locator('#viewer').evaluate(v=>v.arcade.projectControl('B2'));
  const touch=page.viewportSize().width<700?await page.context().newCDPSession(page):null;
  if(touch){await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});}
  else{await page.mouse.move(point.x,point.y);await page.mouse.down();}
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>v.arcade.snapshot().buttons[1].depthMm),{timeout:3000}).toBeGreaterThan(.3);
  if(touch){await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();}
  else await page.mouse.up();
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>Math.abs(v.arcade.snapshot().buttons[1].depthMm)),{timeout:4000}).toBeLessThan(.05);
  const stick=await page.locator('#viewer').evaluate(v=>v.arcade.projectControl('STICK'));
  await page.mouse.move(stick.x,stick.y);await page.mouse.down();await page.mouse.move(stick.x+38,stick.y-8,{steps:5});
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>v.arcade.snapshot().stick.tiltDegrees)).toBeGreaterThan(8);
  await page.mouse.up();
  await expect.poll(()=>page.locator('#viewer').evaluate(v=>v.arcade.snapshot().stick.tiltDegrees),{timeout:4000}).toBeLessThan(.2);
  expect(await page.locator('#viewer').evaluate(v=>Boolean(v.arcade.scene.getObjectByName('Tab5DisplaySurface').material.map.isCanvasTexture))).toBe(true);
  await page.locator('#tab5-turbo').check({force:true});
  expect(await page.locator('#viewer').evaluate(v=>v.arcade.turbo)).toBe(true);
  await page.locator('#tab5-macro').selectOption('JKL');
  await page.locator('#input-readout').evaluate(e=>{
    window.macroInputs=[];
    new MutationObserver(()=>window.macroInputs.push(e.value)).observe(e,{childList:true,subtree:true});
  });
  await page.locator('#run-macro').click();
  await expect.poll(()=>page.evaluate(()=>window.macroInputs.filter(value=>/B[356]/.test(value)))).toEqual(['入力：B3','入力：B5','入力：B6']);
  await expect(page.locator('#run-macro')).toBeEnabled();
  await page.getByRole('button',{name:'視点と表示設定をリセット'}).click();
  await expect(page.locator('.stage')).toHaveAttribute('data-play','false');
  await expect(page.locator('#background-color')).toHaveValue('#e9e9e7');
  expect(errors).toEqual([]);
});
