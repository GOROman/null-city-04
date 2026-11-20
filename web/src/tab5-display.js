export function drawTab5(ctx, {buttons = [], x = 0, y = 0, turbo = false, macro = 'UIO', running = false} = {}) {
  const {width, height} = ctx.canvas;
  ctx.save();
  ctx.scale(width / 1024, height / 576);
  const background = ctx.createLinearGradient(0, 0, 1024, 576);
  background.addColorStop(0, '#081e33');
  background.addColorStop(1, '#040811');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1024, 576);
  const line = (a, b, c, d, color, weight = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = weight;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
  };
  const box = (x, y, w, h, color, fill = '#102234') => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();
  };
  const text = (value, x, y, size, color, weight = 500, font = 'monospace') => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillText(value, x, y);
  };
  const cyan = '#60eaff', ice = '#dceefa', dim = '#8eacc4', rail = '#28546a';
  for (let i = 0; i < 1024; i += 32) line(i, 0, i, 576, '#77d4ff0b');
  for (let i = 0; i < 576; i += 32) line(0, i, 1024, i, '#77d4ff0b');
  line(33, 28, 33, 104, cyan, 4);
  text('NULL CITY IV / NC-04', 55, 51, 21, cyan, 650);
  text('INTELLIGENT STICK', 51, 105, 49, ice, 750, 'sans-serif');
  text('INPUT MONITOR', 772, 58, 20, dim, 600);
  line(33, 129, 991, 129, rail, 2);

  box(42, 150, 350, 248, rail);
  text('STICK / 8-WAY', 67, 184, 19, dim, 600);
  const cx = 217, cy = 287, radius = 82;
  ctx.strokeStyle = '#35687d';
  ctx.lineWidth = 2;
  for (const r of [34, 59, radius]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  line(cx - radius, cy, cx + radius, cy, rail);
  line(cx, cy - radius, cx, cy + radius, rail);
  for (let step = 0; step < 8; step++) {
    const angle = step * Math.PI / 4;
    const active = Math.hypot(x, y) > .15 && ((Math.round(Math.atan2(y, x) * 4 / Math.PI) + 8) % 8) === step;
    ctx.fillStyle = active ? cyan : '#4d8ba4';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * radius, cy - Math.sin(angle) * radius, active ? 8 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
  line(cx, cy, cx + x * 62, cy - y * 62, cyan, 3);
  ctx.fillStyle = cyan;
  ctx.beginPath();
  ctx.arc(cx + x * 62, cy - y * 62, 9, 0, Math.PI * 2);
  ctx.fill();

  box(415, 150, 567, 248, rail);
  text('ACTION MATRIX', 442, 184, 19, dim, 600);
  const order = [['B1','U'],['B2','I'],['B4','O'],['B3','J'],['B5','K'],['B6','L']];
  order.forEach(([id, letter], index) => {
    const x = 520 + (index % 3) * 178;
    const y = 245 + Math.floor(index / 3) * 90;
    const active = buttons.includes(id);
    box(x - 47, y - 28, 94, 58, active ? cyan : rail, active ? '#1b697d' : '#122b3d');
    text(letter, x - 10, y + 12, 32, active ? '#ffffff' : ice, 700);
  });

  box(42, 423, 350, 107, turbo ? cyan : rail);
  text('TURBO / U', 66, 459, 21, dim, 600);
  text(turbo ? 'ON' : 'OFF', 66, 507, 37, turbo ? cyan : ice, 700);
  box(415, 423, 567, 107, running ? cyan : rail);
  text('MACRO', 442, 459, 21, dim, 600);
  text([...macro].join(' → '), 442, 507, 36, ice, 700);
  text(running ? 'RUNNING' : 'READY', running ? 822 : 856, 502, 19, running ? cyan : dim, 650);
  ctx.restore();
}
