// Layout, font sizes and RGB565 palette follow the Tab5 firmware at 1280 × 720.
const width = 1280;
const height = 720;
const names = ['G', 'P', 'K', 'COIN', '1P', '2P'];
const logWidth = 261;
const logLeft = width - logWidth - 18;
const controls = logLeft - 12;
const top = 158;
const monitorHeight = 316;
const palette = Object.fromEntries(Object.entries({
  background: 0x0842, panel: 0x10c6, stroke: 0x32cc, ring: 0x21a8,
  accent: 0x9fff, active: 0x4efa, bright: 0xa7ff, text: 0xe75d, muted: 0x7dd9,
}).map(([name, rgb]) => [name, `rgb(${Math.round((rgb >> 11) * 255 / 31)},${Math.round(((rgb >> 5) & 63) * 255 / 63)},${Math.round((rgb & 31) * 255 / 31)})`]));

const buttonMap = {B1:'G', B2:'P', B4:'K', B3:'G', B5:'P', B6:'K', START:'COIN', P1:'1P', P2:'2P'};

export function tab5Input({buttons, x, y}) {
  const sector = Math.round(Math.atan2(-y, x) * 4 / Math.PI);
  const direction = Math.hypot(x, y) >= .2
    ? [Math.round(Math.cos(sector * Math.PI / 4)), Math.round(Math.sin(sector * Math.PI / 4))] : [0, 0];
  return {buttons:names.filter(name=>buttons.some(button=>buttonMap[button]===name)), x:direction[0], y:direction[1]};
}

export function tab5LogEntry(previous, next, time) {
  const pressed = next.buttons.filter(button=>!previous.buttons.includes(button));
  const moved = (next.x || next.y) && (next.x !== previous.x || next.y !== previous.y);
  return pressed.length || moved ? {...next, buttons:pressed, time} : null;
}

export function drawTab5(ctx, {buttons = [], x = 0, y = 0, log = []} = {}) {
  const c = palette;
  ctx.save();
  ctx.scale(ctx.canvas.width / width, ctx.canvas.height / height);
  const fill = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const path = (color, outline) => {
    if (color) { ctx.fillStyle=color; ctx.fill(); }
    if (outline) { ctx.strokeStyle=outline; ctx.stroke(); }
  };
  const rect = (x, y, w, h, radius, color, outline) => {
    ctx.beginPath(); ctx.roundRect(x,y,w,h,radius); path(color,outline);
  };
  const circle = (x, y, radius, color, outline) => {
    ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); path(color,outline);
  };
  const text = (value, x, y, size, color, align = 'left') => {
    ctx.font=`italic ${size}px Null, sans-serif`;
    ctx.textAlign=align; ctx.textBaseline='middle'; ctx.fillStyle=color; ctx.fillText(value,x,y);
  };
  const tile = (label, x, y, w, h, size, enabled = false) => {
    rect(x+4,y+4,w-8,h-8,8,enabled?c.active:c.panel,enabled?c.bright:c.stroke);
    text(label,x+w/2,y+h/2,size,enabled?c.background:c.text,'center');
  };
  const arrow = (x,y,dx,dy) => {
    if (!dx && !dy) return;
    const diagonal=dx && dy;
    const reach=diagonal?13:18, shaft=diagonal?4:6, wing=diagonal?8:11;
    const points=[[-reach,-shaft],[0,-shaft],[0,-wing],[reach,0],[0,wing],[0,shaft],[-reach,shaft]];
    ctx.beginPath();
    points.forEach(([along,across],i)=>ctx[i?'lineTo':'moveTo'](x+dx*along-dy*across,y+dy*along+dx*across));
    ctx.closePath(); path(c.accent);
  };

  fill(0,0,width,height,c.background);
  text('INTELLIGENT STICK',18,39,48,c.accent);
  text('NULL CITY NC-04',width-18,32,28,c.text,'right');
  fill(18,86,width-36,1,c.stroke);
  text('USB ---    BLE ---',18,115,28,c.muted);

  const sx=Math.floor(controls*.22), sy=top+158, radius=152;
  circle(sx,sy,radius,c.panel,c.stroke);
  circle(sx,sy,114,null,c.ring);
  for (const dx of [-1,0,1]) for (const dy of [-1,0,1]) {
    if (!dx && !dy) continue;
    const offset=dx && dy?91:129;
    circle(sx+dx*offset,sy+dy*offset,3,c.muted);
  }
  const travel=x && y?54:76;
  circle(sx+x*travel,sy+y*travel,50,x||y?c.active:c.stroke,c.bright);

  const left=Math.floor(controls*.44), column=Math.floor((controls-left)/3);
  names.forEach((name,i)=>{
    const bx=left+i%3*column+Math.floor(column/2), by=top+Math.floor(158*(i<3?[1.52,1.34,1.42][i]:.38));
    const active=buttons.includes(name);
    circle(bx,by,i<3?72:48,active?c.active:c.panel,active?c.bright:c.stroke);
    text(name,bx,by,28,active?c.background:c.text,'center');
  });

  ['DOPPO','AKIRA SPECIAL','1000 PUNCH','FACE RIGHT','PKG TUNE'].forEach((label,i)=>tile(label,i*197,504,197,194,22));
  fill(logLeft-9,top,1,547,c.stroke);
  text('INPUT LOG',logLeft+2,top+13,24,c.muted);
  text('LIVE',width-23,top+15,15,c.muted,'right');
  for (let i=0;i<7;i++) {
    const row=201+i*64, middle=row+41, entry=log[log.length-7+i];
    rect(logLeft,row,logWidth,60,5,c.panel);
    if (!entry) {
      if (!log.length && i===6) text('WAITING FOR INPUT',logLeft+12,middle,15,c.muted);
      continue;
    }
    arrow(logLeft+22,middle,entry.x,entry.y);
    entry.buttons.forEach((label,j)=>{
      const bx=logLeft+54+j*29;
      circle(bx,middle,13,c.active,c.bright);
      text(label,bx,middle,label==='COIN'?10:15,c.background,'center');
    });
    text(`${entry.time} MS`,width-24,row+12,15,c.muted,'right');
  }
  ['OLDER','NEWER','CLEAR'].forEach((label,i)=>tile(label,logLeft+i*87,655,87,50,20,label==='CLEAR'&&log.length>0));
  ctx.restore();
}
