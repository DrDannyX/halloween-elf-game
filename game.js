import * as THREE from 'three';

// ============================================================================
// Config
// ============================================================================
const CFG = {
  worldRadius: 54,
  candyCount: 8,
  walkSpeed: 4.2,
  sprintSpeed: 7.4,
  staminaDrain: 28,     // per second while sprinting
  staminaRegen: 18,
  elfBaseSpeed: 3.0,
  elfSpeedPerCandy: 0.35,
  elfGraceTime: 6,      // seconds before he starts hunting
  naturalSight: 4.5,    // moonlight lets you see him this close without a flashlight
  maxSight: 30,
  flashRange: 28,
  batteryDrain: 1 / 100,
  safeRadius: 4.6,      // nothing evil can enter the cauldron's glow
  catchDist: 0.95,
  lookSpeed: 2.8,
  elfLurkRadius: 12,   // how close you must wander before a lurking elf notices you (+1.2 per candy)
  ghostCount: 4,
  skeletonCount: 6,
  damage: { ghost: 20, skeleton: 15, spider: 15 },
};

const STEP = 0.45;      // max height you can step up onto
const GRAVITY = 22;
const PLAYER_R = 0.35, PLAYER_H = 1.7;

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// deterministic world generation
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(31031);
const rand = (a, b) => a + (b - a) * rng();
const rrand = (a, b) => a + (b - a) * Math.random();

// ============================================================================
// Renderer / scene
// ============================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// phones and tablets get a lighter load: lower resolution, fewer particles, smaller shadows
const LOW_POWER = window.matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW_POWER ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0x0d0a18);
scene.background = FOG_COLOR.clone();
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.05);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 600);
camera.position.set(0, 5, 14);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ============================================================================
// Procedural textures
// ============================================================================
function canvasTex(w, h, draw, { repeat = 0, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, base, colors, count, size) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.globalAlpha = Math.random() * 0.6 + 0.2;
    const s = Math.random() * size + 1;
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, s, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

const groundTex = canvasTex(512, 512, (g, w, h) => {
  speckle(g, w, h, '#16170f', ['#21251a', '#0c0b08', '#2b2618', '#3b2413', '#4a2a10', '#1b2414'], 5000, 5);
}, { repeat: 54 });

const stoneTex = canvasTex(256, 256, (g, w, h) => {
  speckle(g, w, h, '#5d5b62', ['#47454c', '#77747c', '#3a4a32', '#2f3a29', '#6a6870'], 1400, 4);
});

const barkTex = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = '#1e1813'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = Math.random() < 0.5 ? '#0d0a08' : '#2c241c';
    g.lineWidth = Math.random() * 3 + 1;
    const x = Math.random() * w;
    g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + rrand(-8, 8), h / 3, x + rrand(-8, 8), h * 2 / 3, x + rrand(-6, 6), h); g.stroke();
  }
});

const woodTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#211a17'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    g.fillStyle = Math.random() < 0.5 ? '#1a1412' : '#2a211c';
    g.fillRect(0, y, w, 14);
    g.fillStyle = '#0a0706'; g.fillRect(0, y + 14, w, 2);
  }
});

const glowTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

const mistTex = canvasTex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = rrand(20, 70);
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, 'rgba(255,255,255,.22)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}, { repeat: 6 });

function windowTex(lit) {
  return canvasTex(64, 80, (g, w, h) => {
    if (lit) {
      const gr = g.createRadialGradient(w / 2, h * 0.6, 4, w / 2, h / 2, 50);
      gr.addColorStop(0, '#ffd27a'); gr.addColorStop(1, '#c4561a');
      g.fillStyle = gr;
    } else g.fillStyle = '#07060c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0b0705';
    g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5); g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);
    g.fillRect(w / 2 - 2, 0, 4, h); g.fillRect(0, h / 2 - 2, w, 4);
    if (!lit && Math.random() < 0.6) { // broken glass
      g.strokeStyle = '#2a2a3a'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(w * 0.3, h * 0.3); g.lineTo(Math.random() * w, Math.random() * h); g.stroke(); }
    }
  });
}
const litWindowTex = windowTex(true);
const darkWindowTex = windowTex(false);

const webTex = canvasTex(128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(230,230,240,.7)'; g.lineWidth = 1;
  const spokes = 9;
  for (let i = 0; i <= spokes; i++) {
    const a = (i / spokes) * (Math.PI / 2);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); g.stroke();
  }
  for (let r = 12; r < 128; r += 13 + Math.random() * 6) {
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * (Math.PI / 2), rr = r + Math.random() * 4;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
});

// Sphere UV → local position (matches THREE.SphereGeometry): u in [0,1], v from top.
function spherePoint(u, v, r) {
  const phi = u * Math.PI * 2, theta = v * Math.PI;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}

// Jack-o'-lantern faces: centered at u=0.25 (x=128 on a 512 wide canvas) which faces +Z.
function drawPumpkinFace(g, variant) {
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#fff';
  const cx = 128;
  const tri = (pts) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };
  if (variant === 0) {
    tri([cx - 46, 122, cx - 28, 86, cx - 10, 122]);
    tri([cx + 10, 122, cx + 28, 86, cx + 46, 122]);
    tri([cx - 7, 140, cx, 126, cx + 7, 140]);
    g.beginPath(); g.moveTo(cx - 58, 150);
    const teeth = [[-44, 166], [-34, 156], [-22, 172], [-10, 160], [0, 174], [10, 160], [22, 172], [34, 156], [44, 166], [58, 150]];
    for (const [x, y] of teeth) g.lineTo(cx + x, y);
    g.quadraticCurveTo(cx, 220, cx - 58, 150); g.fill();
  } else if (variant === 1) {
    tri([cx - 44, 104, cx - 10, 118, cx - 36, 128]);
    tri([cx + 44, 104, cx + 10, 118, cx + 36, 128]);
    g.beginPath(); g.moveTo(cx - 52, 152); g.quadraticCurveTo(cx, 168, cx + 52, 152); g.quadraticCurveTo(cx, 206, cx - 52, 152); g.fill();
    g.fillStyle = '#000';
    g.fillRect(cx - 22, 152, 10, 16); g.fillRect(cx + 12, 152, 10, 16);
  } else {
    g.beginPath(); g.arc(cx - 26, 110, 14, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx + 26, 110, 14, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx, 168, 22, 28, 0, 0, Math.PI * 2); g.fill();
  }
}
const pumpkinFaces = [0, 1, 2].map((v) => canvasTex(512, 256, (g) => drawPumpkinFace(g, v)));

// The Elf's face: rosy cheeks, angry brows, side-eye and a too-wide grin.
const ELF_PUPILS = [[110, 122], [166, 122]];
const elfFaceTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#f1ccb0'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#3e2412'; g.fillRect(0, 0, w, 78);
  for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 76); g.lineTo(x + 8, 96); g.lineTo(x + 16, 76); g.fill(); }
  const cx = 128;
  for (const x of [cx - 52, cx + 52]) {
    const gr = g.createRadialGradient(x, 152, 0, x, 152, 26);
    gr.addColorStop(0, 'rgba(230,80,90,.75)'); gr.addColorStop(1, 'rgba(230,80,90,0)');
    g.fillStyle = gr; g.fillRect(x - 30, 120, 60, 60);
  }
  for (const x of [cx - 28, cx + 28]) {
    g.fillStyle = '#fbf7f0'; g.beginPath(); g.ellipse(x, 118, 21, 25, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a0d08'; g.lineWidth = 3; g.stroke();
  }
  g.fillStyle = '#0a0505';
  for (const [x, y] of ELF_PUPILS) { g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#2e1709'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 52, 84); g.lineTo(cx - 10, 98); g.stroke();
  g.beginPath(); g.moveTo(cx + 52, 84); g.lineTo(cx + 10, 98); g.stroke();
  g.strokeStyle = '#c99479'; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, 138, 7, 0.2, Math.PI - 0.2); g.stroke();
  g.beginPath(); g.moveTo(cx - 56, 154); g.quadraticCurveTo(cx, 174, cx + 56, 154); g.quadraticCurveTo(cx, 222, cx - 56, 154);
  g.fillStyle = '#2a0303'; g.fill();
  g.save(); g.clip();
  g.fillStyle = '#f4efe2';
  for (let x = cx - 60; x < cx + 60; x += 11) {
    g.beginPath(); g.moveTo(x, 150); g.lineTo(x + 11, 150); g.lineTo(x + 5.5, 176); g.fill();
    g.beginPath(); g.moveTo(x + 3, 214); g.lineTo(x + 14, 214); g.lineTo(x + 8.5, 190); g.fill();
  }
  g.restore();
  g.strokeStyle = '#1a0202'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(cx - 56, 154); g.quadraticCurveTo(cx, 174, cx + 56, 154); g.quadraticCurveTo(cx, 222, cx - 56, 154); g.stroke();
});
const elfEyeGlowTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 6;
  for (const [x, y] of ELF_PUPILS) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
});

// Skull face, centered at u=0.25 on a 256x128 canvas.
const skullTex = canvasTex(256, 128, (g, w, h) => {
  speckle(g, w, h, '#d9d0b6', ['#c4b99c', '#e8e0c8', '#b3a88a'], 300, 3);
  const cx = 64;
  g.fillStyle = '#060404';
  g.beginPath(); g.ellipse(cx - 15, 58, 10, 12, 0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx + 15, 58, 10, 12, -0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(cx, 70); g.lineTo(cx - 6, 82); g.lineTo(cx + 6, 82); g.fill();
  g.fillRect(cx - 18, 90, 36, 10);
  g.fillStyle = '#e8e0c8';
  for (let x = cx - 17; x < cx + 17; x += 5) g.fillRect(x, 90, 4, 9);
  g.strokeStyle = '#3a3226'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(cx + 22, 20); g.lineTo(cx + 18, 34); g.lineTo(cx + 26, 42); g.stroke();
});

// A window with an elf silhouette watching you from the tower.
const towerWindowTex = canvasTex(128, 192, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, 110);
  gr.addColorStop(0, '#bfff9a'); gr.addColorStop(1, '#2f7a2a');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = '#050505';
  g.beginPath(); g.arc(64, 98, 22, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(40, 92); g.lineTo(64, 30); g.lineTo(90, 92); g.fill();
  g.beginPath(); g.moveTo(30, 192); g.quadraticCurveTo(64, 110, 98, 192); g.fill();
  g.fillStyle = '#ff2a00';
  g.fillRect(52, 96, 6, 4); g.fillRect(70, 96, 6, 4);
  g.fillStyle = '#0a0a0a'; g.fillRect(60, 0, 8, h); g.fillRect(0, 60, w, 8);
});

const candyTex = canvasTex(16, 64, (g) => {
  g.fillStyle = '#fff6e0'; g.fillRect(0, 0, 16, 20);
  g.fillStyle = '#ff7a10'; g.fillRect(0, 20, 16, 24);
  g.fillStyle = '#ffd21f'; g.fillRect(0, 44, 16, 20);
});

// ============================================================================
// Geometry helpers
// ============================================================================
function mergeGeos(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, o * 2);
    o += p.attributes.position.count;
  }
  geos.forEach((g) => g.dispose());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);

// Autumn leaves: alpha-tested quads with per-leaf colors, clustered around branch tips.
const LEAF_COLORS = [0xd0601a, 0xe07a18, 0xb03a16, 0x8e2418, 0xc09a2a, 0x7a5222, 0xc8401a].map((c) => new THREE.Color(c));
function makeLeafGeo(tips, perTip, size, palette = LEAF_COLORS, spread = 0.45) {
  const pos = [], nor = [], uv = [], col = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), n = new THREE.Vector3();
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (const { end, dir } of tips) {
    for (let k = 0; k < perTip; k++) {
      const c = end.clone().addScaledVector(dir, rand(-0.2, 0.35))
        .add(new THREE.Vector3(rand(-spread, spread), rand(-spread * 0.55, spread * 0.75), rand(-spread, spread)));
      q.setFromEuler(e.set(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)));
      n.set(0, 0, 1).applyQuaternion(q).add(new THREE.Vector3(0, 0.6, 0)).normalize();
      const sz = size * rand(0.7, 1.3);
      const color = palette[(rng() * palette.length) | 0].clone().multiplyScalar(rand(0.75, 1.25));
      for (const [u, v] of corners) {
        const p = new THREE.Vector3(u * sz, v * sz, 0).applyQuaternion(q).add(c);
        pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(u + 0.5, v + 0.5); col.push(color.r, color.g, color.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const BUSH_COLORS = [0x2e3a16, 0x3d4a1a, 0x4a3a14, 0x6e2a12, 0x8a3412, 0x2a3018, 0x5a5a1e, 0x7a1e14].map((c) => new THREE.Color(c));
function makeBushGeo(size) {
  const geos = [], tips = [];
  const stems = 6 + ((rng() * 4) | 0);
  for (let i = 0; i < stems; i++) {
    const a = rand(0, Math.PI * 2), lean = rand(0.3, 0.9);
    const dir = new THREE.Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const len = size * rand(0.6, 1.0);
    const g = new THREE.CylinderGeometry(0.015, 0.035, len, 4, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
    g.translate(0, -0.1, 0);
    geos.push(g);
    const end = dir.clone().multiplyScalar(len).add(new THREE.Vector3(0, -0.1, 0));
    tips.push({ end, dir });
    tips.push({ end: end.clone().multiplyScalar(0.6), dir: new THREE.Vector3(Math.cos(a + 1), 0.5, Math.sin(a + 1)).normalize() });
  }
  // fill out a rounded mound of foliage
  for (let k = 0; k < 16; k++) {
    const a = rand(0, Math.PI * 2), r = Math.sqrt(rng()) * size * 0.8;
    tips.push({ end: new THREE.Vector3(Math.cos(a) * r, rand(0.25, 0.95) * size * (1 - (r / size) * 0.5), Math.sin(a) * r), dir: UP });
  }
  return { bark: mergeGeos(geos), leaves: makeLeafGeo(tips, 8, 0.32, BUSH_COLORS, 0.35), r: size * 0.75, h: size };
}

function makeTreeGeo(depth = 4, height = [3.2, 5.5], leafDensity = 7, radius = [0.2, 0.5]) {
  const geos = [];
  const tips = [];
  function branch(start, dir, len, rad, depth) {
    const g = new THREE.CylinderGeometry(rad * 0.62, rad, len, 6, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
    g.translate(start.x, start.y, start.z);
    geos.push(g);
    const end = start.clone().addScaledVector(dir, len);
    if (depth <= 1) tips.push({ end, dir });
    if (depth <= 0 || rad < 0.025) return;
    const n = 2 + (rng() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const nd = dir.clone();
      nd.x += rand(-1, 1); nd.z += rand(-1, 1); nd.y += rand(-0.15, 0.4);
      nd.normalize();
      const s = start.clone().lerp(end, i === 0 ? 0.98 : rand(0.5, 0.95));
      branch(s, nd, len * rand(0.55, 0.78), rad * 0.6, depth - 1);
    }
  }
  const h = rand(height[0], height[1]);
  const trunkR = rand(radius[0], radius[1]);
  branch(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(rand(-0.15, 0.15), 1, rand(-0.15, 0.15)).normalize(), h, trunkR, depth);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rand(-0.4, 0.4);
    const d = new THREE.Vector3(Math.cos(a), -0.35, Math.sin(a)).normalize();
    const rs = trunkR / 0.34;  // roots flare out more on thick trunks
    const g = new THREE.CylinderGeometry(0.03 * rs, 0.16 * rs, 1.4 * Math.sqrt(rs), 5, 1, true);
    g.translate(0, 0.7, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d));
    g.translate(0, 0.35, 0);
    geos.push(g);
  }
  return { bark: mergeGeos(geos), leaves: makeLeafGeo(tips, leafDensity, 0.42), r: trunkR };
}

function makeGraveGeo(type) {
  const geos = [];
  if (type === 0) {
    const b = new THREE.BoxGeometry(0.9, 1.0, 0.22); b.translate(0, 0.5, 0); geos.push(b);
    const t = new THREE.CylinderGeometry(0.45, 0.45, 0.22, 16, 1, false, -Math.PI / 2, Math.PI);
    t.rotateX(-Math.PI / 2); t.translate(0, 1.0, 0); geos.push(t);
  } else if (type === 1) {
    const v = new THREE.BoxGeometry(0.18, 1.7, 0.18); v.translate(0, 0.85, 0); geos.push(v);
    const h = new THREE.BoxGeometry(0.85, 0.18, 0.18); h.translate(0, 1.2, 0); geos.push(h);
  } else if (type === 2) {
    const base = new THREE.BoxGeometry(0.6, 0.35, 0.6); base.translate(0, 0.17, 0); geos.push(base);
    const col = new THREE.CylinderGeometry(0.13, 0.24, 1.9, 4); col.rotateY(Math.PI / 4); col.translate(0, 1.3, 0); geos.push(col);
    const tip = new THREE.ConeGeometry(0.16, 0.3, 4); tip.rotateY(Math.PI / 4); tip.translate(0, 2.4, 0); geos.push(tip);
  } else {
    const s = new THREE.BoxGeometry(1.0, 0.7, 0.16); s.translate(0, 0.35, 0); geos.push(s);
  }
  return mergeGeos(geos);
}

function makePumpkinGeo() {
  const g = new THREE.SphereGeometry(1, 28, 18);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const s = 1 - 0.075 * (0.5 - 0.5 * Math.cos(a * 8));
    p.setXYZ(i, x * s, y * 0.78 - (y > 0.85 ? 0.06 : 0), z * s);
  }
  g.computeVertexNormals();
  return g;
}

// ============================================================================
// Terrain: rolling hills, flattened under the houses and around the cauldron
// ============================================================================
const HOUSE_DEFS = [
  { cx: -28, cz: -30, k: 0, W: 12, D: 9, wall: 0xe0ccb8, roof: 0x1a1210, tower: true },
  { cx: 33, cz: -26, k: 3, W: 10, D: 8, wall: 0xb4cccc, roof: 0x221a26 },
  { cx: -4, cz: 40, k: 2, W: 10, D: 8, wall: 0xccb8e0, roof: 0x14101a },
];

function rawHeight(x, z) {
  let h = 1.6 * Math.sin(x * 0.071 + 0.4) * Math.cos(z * 0.063 - 0.8)
    + 1.0 * Math.sin(x * 0.13 + 1.7) * Math.sin(z * 0.11 + 0.5)
    + 0.35 * Math.sin(x * 0.31 + z * 0.27);
  h += 4.5 * Math.exp(-((x - 24) ** 2 + (z - 14) ** 2) / 250);  // Hollow Hill (the graveyard)
  h += 6.0 * Math.exp(-((x + 41) ** 2 + (z + 5) ** 2) / 120);   // the lookout
  h -= 2.6 * Math.exp(-((x - 8) ** 2 + (z + 26) ** 2) / 90);    // the hollow
  const r = Math.hypot(x, z);
  if (r > 50) h += Math.pow(r - 50, 1.3) * 0.15;                 // walls of the valley
  return h;
}

const PADS = HOUSE_DEFS.map((d) => {
  const hw = (d.k % 2 ? d.D : d.W) / 2 + 2.5, hd = (d.k % 2 ? d.W : d.D) / 2 + 2.5;
  return { cx: d.cx, cz: d.cz, hw, hd, h: rawHeight(d.cx, d.cz) };
});

function heightAt(x, z) {
  let h = rawHeight(x, z);
  h = lerp(0, h, smoothstep(5, 11, Math.hypot(x, z)));
  for (const p of PADS) {
    const d = Math.max(Math.abs(x - p.cx) - p.hw, Math.abs(z - p.cz) - p.hd, 0);
    if (d < 7) h = lerp(p.h, h, smoothstep(0, 7, d));
  }
  return h;
}

function inHouseFootprint(x, z, margin = 0) {
  return PADS.some((p) => Math.abs(x - p.cx) < p.hw - 2.5 + margin && Math.abs(z - p.cz) < p.hd - 2.5 + margin);
}

function terrainGeo(size, seg, yOff, withAlpha = false) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = withAlpha ? new Float32Array(p.count * 4) : null;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, heightAt(x, z) + yOff);
    if (col) {
      const inside = inHouseFootprint(x, z, 1.5);
      col.set([1, 1, 1, inside ? 0 : 1], i * 4);
    }
  }
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.computeVertexNormals();
  return g;
}

// ============================================================================
// Physics world: AABB solids (walls, floors, stairs) and circles (trees, graves)
// ============================================================================
const solids = [];      // {minX,maxX,minY,maxY,minZ,maxZ}
const circles = [];     // {x,z,r,y,h}
const occluders = [];   // meshes that block line of sight
const lightZones = [];  // {pos, r}: areas lit well enough to see the elf

function addCircle(x, z, r, h = 3, y = heightAt(x, z)) { circles.push({ x, z, r, y: y - 0.5, h: h + 0.5 }); }

function groundAt(x, z, y) {
  let g = heightAt(x, z);
  for (const b of solids) {
    if (b.maxY > g && b.maxY <= y + STEP + 0.01 && x >= b.minX - 0.1 && x <= b.maxX + 0.1 && z >= b.minZ - 0.1 && z <= b.maxZ + 0.1) g = b.maxY;
  }
  return g;
}

function collide(pos, radius, height) {
  for (const c of circles) {
    if (pos.y > c.y + c.h || pos.y + height < c.y) continue;
    const dx = pos.x - c.x, dz = pos.z - c.z, min = c.r + radius, d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = c.x + (dx / d) * min; pos.z = c.z + (dz / d) * min; }
  }
  for (const b of solids) {
    if (b.maxY <= pos.y + STEP || b.minY >= pos.y + height) continue;
    const cx = clamp(pos.x, b.minX, b.maxX), cz = clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = cx + (dx / d) * radius; pos.z = cz + (dz / d) * radius; }
    else {
      const opts = [[pos.x - b.minX, 0], [b.maxX - pos.x, 1], [pos.z - b.minZ, 2], [b.maxZ - pos.z, 3]].sort((a, c) => a[0] - c[0]);
      const side = opts[0][1];
      if (side === 0) pos.x = b.minX - radius; else if (side === 1) pos.x = b.maxX + radius;
      else if (side === 2) pos.z = b.minZ - radius; else pos.z = b.maxZ + radius;
    }
  }
  const r = Math.hypot(pos.x, pos.z), maxR = CFG.worldRadius;
  if (r > maxR) { pos.x *= maxR / r; pos.z *= maxR / r; }
}

function blockedAt(x, z, y, r, height = 1.8) {
  for (const c of circles) {
    if (y > c.y + c.h || y + height < c.y) continue;
    if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
  }
  for (const b of solids) {
    if (b.maxY <= y + STEP || b.minY >= y + height) continue;
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
  }
  return Math.hypot(x, z) > CFG.worldRadius;
}

// Is the way ahead blocked? Tested at the height you'd be standing at there, so stairs aren't walls.
function probeBlocked(pos, angle, dist, r) {
  const px = pos.x + Math.sin(angle) * dist, pz = pos.z + Math.cos(angle) * dist;
  return blockedAt(px, pz, groundAt(px, pz, pos.y), r);
}

// gravity / stepping for anything that walks: ent = {pos, vy}
function settle(ent, dt) {
  const g = groundAt(ent.pos.x, ent.pos.z, ent.pos.y);
  if (g >= ent.pos.y || (ent.pos.y - g < 0.3 && ent.vy <= 0)) { ent.pos.y = g; ent.vy = 0; }
  else {
    ent.vy -= GRAVITY * dt;
    ent.pos.y = Math.max(g, ent.pos.y + ent.vy * dt);
    if (ent.pos.y === g) ent.vy = 0;
  }
}

function isFree(x, z, r, { minCenter = 0 } = {}) {
  const rc = Math.hypot(x, z);
  if (rc < minCenter || rc > CFG.worldRadius - r - 1) return false;
  for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
  for (const b of solids) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return false;
  return !inHouseFootprint(x, z, r + 1.5);
}

// 2D segment vs rectangle (slab method)
function segRect(ax, az, bx, bz, x0, x1, z0, z1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, x0, x1], [az, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else {
      let ta = (lo - p) / d, tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

// Could something walk in a straight line from a to b (ignoring trees, which steering handles)?
function clearPath(a, b) {
  if (Math.abs(a.y - b.y) > 1.3) return false;
  const lo = Math.max(a.y, b.y) + STEP, hi = Math.min(a.y, b.y) + 1.8;
  for (const s of solids) {
    if (s.maxY <= lo || s.minY >= hi) continue;
    if (segRect(a.x, a.z, b.x, b.z, s.minX - 0.3, s.maxX + 0.3, s.minZ - 0.3, s.maxZ + 0.3)) return false;
  }
  return true;
}

// ============================================================================
// World: sky, moon, lights, ground, mist
// ============================================================================
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x05040e) },
      horizon: { value: new THREE.Color(0x231433) },
      bottom: { value: FOG_COLOR.clone() },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = mix(horizon, top, smoothstep(0.0, 0.55, h)); c = mix(bottom, c, smoothstep(-0.05, 0.12, h));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  const n = 1600, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, y = Math.random() * 0.95 + 0.05;
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * 380, y * 380, Math.sin(a) * r * 380], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xc8c0ff, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75 })));

  const moonDir = new THREE.Vector3(-0.45, 0.42, -1).normalize();
  const moonTex = canvasTex(256, 128, (g, w, h) => speckle(g, w, h, '#f4ecd2', ['#d9cfb2', '#c9bf9f', '#e6dcc0'], 160, 9));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 32, 16), new THREE.MeshBasicMaterial({ map: moonTex, fog: false, color: 0xfff4dc }));
  moon.position.copy(moonDir).multiplyScalar(340);
  scene.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xb9b0ff, fog: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(150); halo.position.copy(moon.position).multiplyScalar(0.99);
  scene.add(halo);

  scene.add(new THREE.HemisphereLight(0x3d3870, 0x0c0806, 0.45));
  const moonLight = new THREE.DirectionalLight(0x8f9cff, 0.4);
  moonLight.position.copy(moonDir).multiplyScalar(100);
  scene.add(moonLight);

  const ground = new THREE.Mesh(terrainGeo(300, 260, 0), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, color: 0x7a7a7a }));
  ground.receiveShadow = true;
  scene.add(ground);
}

const mistLayers = [];
for (const [y, op, sp] of [[0.45, 0.32, 0.6], [1.0, 0.2, -0.4], [1.7, 0.12, 0.3], [2.6, 0.07, -0.2]]) {
  const t = mistTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6);
  const m = new THREE.Mesh(terrainGeo(140, 90, y, true), new THREE.MeshBasicMaterial({
    map: t, color: 0x8478a4, transparent: true, opacity: op, depthWrite: false, vertexColors: true,
  }));
  m.renderOrder = 2;
  scene.add(m);
  mistLayers.push({ tex: t, sp });
}

// ============================================================================
// Materials
// ============================================================================
const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95, color: 0xb8b4c0 });
const wind = { uTime: { value: 0 }, uWind: { value: 1 } };
// Sway grows with height up the tree; leaves also flutter on their own.
function addWind(mat, leaf, bendK = 0.0045) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWind = wind.uWind;
    shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 windOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        windOrigin = instanceMatrix * windOrigin;
      #endif
      windOrigin = modelMatrix * windOrigin;
      float ph = dot(windOrigin.xz, vec2(0.13, 0.17));
      float hgt = max(transformed.y, 0.0);
      float bend = hgt * hgt * ${bendK.toFixed(4)} * uWind;
      transformed.x += bend * (sin(uTime * 1.3 + ph) + 0.4 * sin(uTime * 2.9 + ph * 1.7));
      transformed.z += bend * 0.6 * cos(uTime * 1.1 + ph);
      ${leaf ? `float fl = ${(bendK > 0.01 ? 0.07 : 0.05).toFixed(3)} * uWind * min(1.0, hgt / ${bendK > 0.01 ? '1.0' : '3.0'});
      transformed += fl * vec3(sin(uTime * 7.0 + position.x * 5.0 + ph), sin(uTime * 9.0 + position.z * 6.0), cos(uTime * 8.0 + position.y * 4.0 + ph));` : ''}`);
  };
  mat.customProgramCacheKey = () => (leaf ? 'wind-leaf' : 'wind-bark') + mat.type + bendK;
  return mat;
}
const leafTex = canvasTex(64, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(32, 2);
  for (const [x, y] of [[44, 14], [58, 12], [52, 28], [62, 38], [44, 40], [40, 58], [32, 48], [24, 58], [20, 40], [2, 38], [12, 28], [6, 12], [20, 14]]) g.lineTo(x, y);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(32, 62); g.lineTo(32, 10); g.moveTo(32, 40); g.lineTo(50, 22); g.moveTo(32, 40); g.lineTo(14, 22); g.stroke();
});
const barkMat = addWind(new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1, color: 0x8a7a6a }), false);
const leafMat = addWind(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 }), true);
const barkDepthMat = addWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), false);
const leafDepthMat = addWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.5 }), true);
const bushStemMat = addWind(new THREE.MeshStandardMaterial({ color: 0x1e1610, roughness: 1 }), false, 0.07);
const bushLeafMat = addWind(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9 }), true, 0.07);
function treeMeshes(geo, count) {
  const bark = count ? new THREE.InstancedMesh(geo.bark, barkMat, count) : new THREE.Mesh(geo.bark, barkMat);
  const leaves = count ? new THREE.InstancedMesh(geo.leaves, leafMat, count) : new THREE.Mesh(geo.leaves, leafMat);
  bark.customDepthMaterial = barkDepthMat;
  leaves.customDepthMaterial = leafDepthMat;
  bark.castShadow = leaves.castShadow = true;
  return { bark, leaves };
}
const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x120d0b, roughness: 1 });
const floorMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x6a5a50, roughness: 0.95 });
const ironMat = new THREE.MeshStandardMaterial({ color: 0x15141a, roughness: 0.45, metalness: 0.7 });
const dirtMat = new THREE.MeshStandardMaterial({ color: 0x1f160e, roughness: 1 });
const webMat = new THREE.MeshBasicMaterial({ map: webTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.55 });
const litWindowMats = [];

// ============================================================================
// Houses: two floors, stairs, furniture. Built in local space (door on +Z) and
// rotated by k * 90° so every collider stays an axis-aligned box.
// ============================================================================
const houses = [];
const decoys = [];
const pumpkinRequests = [];  // pumpkins are created later, after the pumpkin factory exists
const towerWindows = [];

function buildHouse(def, pad) {
  const { cx, cz, k, W, D } = def;
  const th = (k * Math.PI) / 2;
  const cos = Math.round(Math.cos(th)), sin = Math.round(Math.sin(th));
  const toW = (lx, lz) => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos];
  const base = pad.h;
  const buckets = new Map();
  const bucket = (mat) => { if (!buckets.has(mat)) buckets.set(mat, []); return buckets.get(mat); };
  const wallMat = new THREE.MeshStandardMaterial({ map: woodTex, color: def.wall, roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ color: def.roof, roughness: 0.9 });

  function box(x0, x1, y0, y1, z0, z1, mat, solid = true) {
    const [ax, az] = toW(x0, z0), [bx, bz] = toW(x1, z1);
    const b = { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minY: base + y0, maxY: base + y1, minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
    if (solid) solids.push(b);
    if (mat) {
      const g = new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      bucket(mat).push(g);
    }
    return b;
  }
  function plane(lx, y, lz, w, h, rotY, mat, rotX = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    if (rotX) g.rotateX(rotX);
    g.rotateY(rotY + th);
    const [wx, wz] = toW(lx, lz);
    g.translate(wx, base + y, wz);
    bucket(mat).push(g);
  }
  const world = (lx, y, lz) => { const [x, z] = toW(lx, lz); return new THREE.Vector3(x, base + y, z); };

  const t = 0.25, FH = 3.2, f1 = 0.3, f2 = f1 + FH, top = f2 + FH;
  const doorX = 0.8, doorHalf = 0.8;
  const hW = W / 2, hD = D / 2;

  // foundation + porch
  box(-hW, hW, -1.5, f1, -hD, hD, stoneMat);
  box(doorX - 1.4, doorX + 1.4, -1, 0.15, hD, hD + 1.3, darkWoodMat);
  // outer walls (both floors in one piece where possible)
  box(-hW, hW, f1, top, -hD, -hD + t, wallMat);                    // back
  box(-hW, -hW + t, f1, top, -hD + t, hD - t, wallMat);            // left
  box(hW - t, hW, f1, top, -hD + t, hD - t, wallMat);              // right
  box(-hW, doorX - doorHalf, f1, f2, hD - t, hD, wallMat);         // front, left of door
  box(doorX + doorHalf, hW, f1, f2, hD - t, hD, wallMat);          // front, right of door
  box(doorX - doorHalf, doorX + doorHalf, f1 + 2.5, f2, hD - t, hD, wallMat);  // above door
  box(-hW, hW, f2, top, hD - t, hD, wallMat);                      // front, upstairs
  // door frame and a door hanging open
  box(doorX - doorHalf - 0.12, doorX - doorHalf, f1, f1 + 2.6, hD - 0.02, hD + 0.06, darkWoodMat, false);
  box(doorX + doorHalf, doorX + doorHalf + 0.12, f1, f1 + 2.6, hD - 0.02, hD + 0.06, darkWoodMat, false);
  box(doorX + doorHalf - 0.06, doorX + doorHalf + 0.02, f1, f1 + 2.45, hD, hD + 1.5, darkWoodMat, false);

  // stairs along the left wall, climbing toward the back
  const sx0 = -hW + t, sx1 = sx0 + 1.3, sStart = hD - t - 1.0, n = 12, run = 0.3, rise = FH / n;
  const sEnd = sStart - n * run;
  for (let i = 0; i < n; i++) box(sx0, sx1, f1, f1 + (i + 1) * rise, sStart - (i + 1) * run, sStart - i * run, floorMat);
  // upstairs floor with a hole above the stairs
  box(sx1, hW - t, f2 - 0.2, f2, -hD + t, hD - t, floorMat);
  box(sx0, sx1, f2 - 0.2, f2, -hD + t, sEnd, floorMat);
  box(sx0, sx1, f2 - 0.2, f2, sStart, hD - t, floorMat);
  // railings around the stairwell
  box(sx1, sx1 + 0.08, f2, f2 + 1.0, sEnd + 0.2, sStart, darkWoodMat);
  box(sx0, sx1 + 0.08, f2, f2 + 1.0, sStart, sStart + 0.08, darkWoodMat);
  for (let z = sEnd + 0.4; z < sStart; z += 0.6) box(sx1 - 0.02, sx1 + 0.1, f2 + 1.0, f2 + 1.08, z - 0.3, z + 0.3, darkWoodMat, false);
  // ceiling
  box(-hW, hW, top - 0.2, top, -hD, hD, darkWoodMat);

  // gable roof
  const roofH = 3.2;
  const shape = new THREE.Shape();
  shape.moveTo(-hW - 0.7, 0); shape.lineTo(hW + 0.7, 0); shape.lineTo(0, roofH); shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: D + 1.2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(D + 1.2) / 2);
  roofGeo.rotateY(th);
  roofGeo.translate(cx, base + top, cz);
  bucket(roofMat).push(roofGeo);
  box(hW - 2, hW - 1.2, top, top + roofH + 0.3, -1.4, -0.6, stoneMat, false);  // chimney

  // windows (outside only)
  const litMat = new THREE.MeshBasicMaterial({ map: litWindowTex });
  litWindowMats.push(litMat);
  const darkMat = new THREE.MeshBasicMaterial({ map: darkWindowTex });
  const win = (lx, y, lz, rotY) => plane(lx, y, lz, 1.1, 1.4, rotY, rng() < 0.6 ? litMat : darkMat);
  win(-hW + 2.4, f1 + 1.6, hD + 0.01, 0);
  win(-hW + 2.4, f2 + 1.6, hD + 0.01, 0); win(hW - 2.2, f2 + 1.6, hD + 0.01, 0); win(doorX, f2 + 1.6, hD + 0.01, 0);
  for (const y of [f1 + 1.6, f2 + 1.6]) {
    win(-hW - 0.01, y, -0.5, -Math.PI / 2);
    win(hW + 0.01, y, -0.5, Math.PI / 2);
    win(-1.5, y, -hD - 0.01, Math.PI); win(2, y, -hD - 0.01, Math.PI);
  }

  // furniture, downstairs
  box(hW - 3.4, hW - 1.6, f1, f1 + 0.85, -hD + 1.0, -hD + 2.0, darkWoodMat);   // table
  box(hW - 3.1, hW - 2.6, f1, f1 + 0.5, -hD + 2.3, -hD + 2.8, darkWoodMat);    // chair
  box(hW - 1.4, hW - t, f1, f1 + 1.0, hD - 2.4, hD - 1.4, floorMat);           // crates
  box(hW - 1.2, hW - t - 0.1, f1 + 1.0, f1 + 1.7, hD - 2.3, hD - 1.6, floorMat);
  box(-1.2, 0.8, f1, f1 + 1.3, -hD + t, -hD + t + 0.6, stoneMat);              // fireplace
  box(-0.8, 0.4, f1, f1 + 0.9, -hD + t + 0.55, -hD + t + 0.65, null, false);
  plane(-0.2, f1 + 0.45, -hD + t + 0.62, 1.0, 0.7, 0, new THREE.MeshBasicMaterial({ color: 0x050302 }));
  // candles on the table
  const candleMat = new THREE.MeshStandardMaterial({ color: 0xeee4c8, emissive: 0x332211 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb040 });
  const candles = [];
  for (const [ox, oz, hgt] of [[-0.3, 0.1, 0.25], [0.2, -0.15, 0.35], [0.4, 0.2, 0.18]]) {
    const p = world(hW - 2.5 + ox, f1 + 0.85, -hD + 1.5 + oz);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, hgt, 8), candleMat);
    c.position.copy(p).add(new THREE.Vector3(0, hgt / 2, 0));
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), flameMat);
    f.scale.y = 1.8; f.position.copy(p).add(new THREE.Vector3(0, hgt + 0.06, 0));
    scene.add(c, f); candles.push(f);
  }
  const candleLight = new THREE.PointLight(0xff8a3a, 8, 10, 1.6);
  candleLight.position.copy(world(hW - 2.5, f1 + 1.5, -hD + 1.5));
  scene.add(candleLight);
  lightZones.push({ pos: candleLight.position.clone(), r: 3.2 });

  // furniture, upstairs
  box(hW - 2.4, hW - t, f2, f2 + 0.55, -hD + t, -hD + 2.2, new THREE.MeshStandardMaterial({ color: 0x3a1820, roughness: 1 }));  // bed
  box(hW - 2.4, hW - t, f2, f2 + 1.2, -hD + t, -hD + t + 0.12, darkWoodMat);    // headboard
  box(0.2, 1.8, f2, f2 + 2.2, -hD + t, -hD + t + 0.7, darkWoodMat);              // wardrobe
  box(-1.8, -0.6, f2, f2 + 0.6, -hD + t + 0.2, -hD + t + 1.0, floorMat);         // trunk

  // more candles: mantel, crates, foot of the stairs; bedside, trunk candelabra, top of the stairs
  box(hW - 3.05, hW - 2.5, f2, f2 + 0.6, -hD + t + 0.05, -hD + t + 0.55, darkWoodMat);   // bedside table
  const cluster = (lx, y, lz, n, spread, holder = null) => {
    const base = world(lx, y, lz);
    const cl = { pos: base.clone(), flames: [], glows: [], ph: rand(0, 100), level: 0 };
    if (holder === 'candelabra') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.06, 0.45, 8), ironMat);
      stem.position.copy(base).add(new THREE.Vector3(0, 0.22, 0));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.025), ironMat);
      arm.position.copy(base).add(new THREE.Vector3(0, 0.42, 0)); arm.rotation.y = th + rand(-0.3, 0.3);
      scene.add(stem, arm);
    }
    for (let i = 0; i < n; i++) {
      const hgt = rand(0.1, 0.32);
      let p;
      if (holder === 'candelabra') {
        const ox = (i - 1) * 0.24;
        p = base.clone().add(new THREE.Vector3(Math.cos(th) * ox, 0.44, -Math.sin(th) * ox));
      } else {
        p = base.clone().add(new THREE.Vector3(rand(-spread, spread), 0, rand(-spread, spread)));
        const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 10), ironMat);
        dish.position.copy(p).add(new THREE.Vector3(0, 0.008, 0));
        scene.add(dish);
      }
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, hgt, 8), candleMat);
      c.position.copy(p).add(new THREE.Vector3(0, hgt / 2, 0));
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), flameMat);
      f.scale.y = 1.8; f.position.copy(p).add(new THREE.Vector3(0, hgt + 0.05, 0));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9440, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(0.4); glow.position.copy(f.position);
      scene.add(c, f, glow);
      cl.flames.push(f); cl.glows.push(glow);
    }
    candleClusters.push(cl);
    lightZones.push({ pos: base.clone().add(new THREE.Vector3(0, 0.6, 0)), r: 2.3 });
  };
  cluster(-0.2, f1 + 1.3, -hD + t + 0.3, 3, 0.35);                     // fireplace mantel
  cluster(hW - 0.75, f1 + 1.7, hD - 1.95, 2, 0.15);                     // on the crates
  cluster(sx1 + 0.45, f1, sStart + 0.35, 3, 0.25);                      // foot of the stairs
  cluster(hW - 2.78, f2 + 0.6, -hD + t + 0.3, 1, 0);                    // bedside
  cluster(-1.2, f2 + 0.6, -hD + t + 0.6, 3, 0, 'candelabra');           // trunk
  cluster(sx0 + 0.55, f2, sEnd - 0.55, 2, 0.2);                         // top of the stairs

  // cobwebs in the corners
  plane(hW - t - 0.6, f2 - 0.8, -hD + t + 0.6, 1.4, 1.4, Math.PI / 4, webMat);
  plane(-hW + t + 2.0, top - 0.9, hD - t - 0.6, 1.4, 1.4, -Math.PI / 4, webMat);
  plane(hW - t - 0.6, top - 0.9, hD - t - 0.6, 1.4, 1.4, Math.PI * 0.75, webMat);

  // optional spooky tower
  if (def.tower) {
    const [tx, tz] = toW(hW + 1.0, hD - 1.4);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2, top + 5, 12), wallMat);
    tower.position.set(tx, base + (top + 5) / 2, tz); tower.castShadow = true;
    const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 5, 12), roofMat);
    towerRoof.position.set(tx, base + top + 7.5, tz); towerRoof.rotation.z = 0.08;
    const tw = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.6), new THREE.MeshBasicMaterial({ map: towerWindowTex }));
    tw.position.set(tx + Math.sin(th) * 1.86, base + top + 2, tz + Math.cos(th) * 1.86); tw.rotation.y = th;
    scene.add(tower, towerRoof, tw);
    addCircle(tx, tz, 2.1, top + 5, base);
    occluders.push(tower);
  }

  for (const [mat, geos] of buckets) {
    const mesh = new THREE.Mesh(mergeGeos(geos), mat);
    mesh.castShadow = mat !== webMat && mat !== litMat && mat !== darkMat;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (mat === wallMat || mat === roofMat || mat === floorMat || mat === stoneMat || mat === darkWoodMat) occluders.push(mesh);
  }

  // porch pumpkins (lights on the first house only), and an elf on a shelf upstairs
  pumpkinRequests.push({ p: world(doorX - 2.0, 0, hD + 0.9), s: 0.4, face: th, light: def.tower });
  pumpkinRequests.push({ p: world(doorX + 2.0, 0, hD + 0.9), s: 0.34, face: th, light: def.tower });
  const shelfPos = world(hW - t - 0.4, f2, 1.0);
  decoyRequests.push({ pos: shelfPos, rotY: th - Math.PI / 2, small: true });

  // spider territory: the upstairs room minus the stairwell
  const r0 = toW(-hW + t + 0.5, -hD + t + 0.5), r1 = toW(hW - t - 0.5, hD - t - 0.5);
  const h0 = toW(sx0 - 0.6, sEnd + 0.2), h1 = toW(sx1 + 0.6, hD);
  houses.push({
    def, base, f1: base + f1, f2: base + f2, top: base + top, th,
    candySpot: world(hW - 1.4, f2, hD - 1.4),
    batterySpot: world(-hW + 2.8, f1, -hD + 1.2),
    spiderHang: world(1.2, top - 1.5, -0.4),
    region: { minX: Math.min(r0[0], r1[0]), maxX: Math.max(r0[0], r1[0]), minZ: Math.min(r0[1], r1[1]), maxZ: Math.max(r0[1], r1[1]) },
    hole: { minX: Math.min(h0[0], h1[0]), maxX: Math.max(h0[0], h1[0]), minZ: Math.min(h0[1], h1[1]), maxZ: Math.max(h0[1], h1[1]) },
    candleLight, candles,
    footprint: pad,
  });
}
const decoyRequests = [];
const candleClusters = [];
HOUSE_DEFS.forEach((d, i) => buildHouse(d, PADS[i]));
// A small pool of lights follows the candles nearest to you, so every candle can glow without dozens of real lights.
const candleLightPool = Array.from({ length: 6 }, () => {
  const l = new THREE.PointLight(0xff8a3a, 0, 8, 1.6);
  scene.add(l);
  return { light: l, cluster: null };
});

function houseAt(p) {
  for (const h of houses) {
    const f = h.footprint;
    if (Math.abs(p.x - f.cx) < f.hw - 2.5 && Math.abs(p.z - f.cz) < f.hd - 2.5 && p.y > h.base) return h;
  }
  return null;
}

// ============================================================================
// Outdoor props
// ============================================================================
const cauldron = {};
{
  const g = new THREE.Group();
  const prof = [[0, 0], [0.7, 0.05], [1.1, 0.35], [1.28, 0.8], [1.2, 1.25], [1.02, 1.42], [1.14, 1.5], [1.06, 1.55]].map(([x, y]) => new THREE.Vector2(x, y));
  const pot = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), new THREE.MeshStandardMaterial({ color: 0x18171c, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide }));
  pot.position.y = 0.45; pot.castShadow = true;
  g.add(pot);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6), ironMat);
    leg.position.set(Math.cos(a) * 0.85, 0.3, Math.sin(a) * 0.85);
    g.add(leg);
  }
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(1.08, 32), new THREE.MeshBasicMaterial({ color: 0x3dff6a }));
  liquid.rotation.x = -Math.PI / 2; liquid.position.y = 0.45 + 1.33;
  g.add(liquid);
  const steam = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x48ff7a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  steam.scale.set(4, 3, 1); steam.position.y = 2.4;
  g.add(steam);
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 6), darkWoodMat);
    log.rotation.z = Math.PI / 2; log.rotation.y = (i / 4) * Math.PI; log.position.y = 0.1;
    g.add(log);
  }
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 6), flameMat);
    const a = (i / 7) * Math.PI * 2;
    f.position.set(Math.cos(a) * 0.45, 0.3, Math.sin(a) * 0.45);
    g.add(f); flames.push(f);
  }
  const bubbles = [];
  const bubMat = new THREE.MeshBasicMaterial({ color: 0x9dffb2 });
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), bubMat);
    b.userData = { phase: Math.random(), x: rrand(-0.7, 0.7), z: rrand(-0.7, 0.7) };
    g.add(b); bubbles.push(b);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(CFG.safeRadius - 0.15, CFG.safeRadius, 96), new THREE.MeshBasicMaterial({ color: 0x3dff6a, transparent: true, opacity: 0.35, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
  g.add(ring);
  const light = new THREE.PointLight(0x55ff77, 14, 13, 1.8);
  light.position.y = 2.6;
  g.add(light);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 120, 24, 1, true), new THREE.MeshBasicMaterial({
    color: 0x3dff6a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  }));
  beam.position.y = 60; beam.visible = false;
  g.add(beam);
  scene.add(g);
  addCircle(0, 0, 1.45);
  lightZones.push({ pos: new THREE.Vector3(0, 1, 0), r: 7 });
  Object.assign(cauldron, { group: g, flames, bubbles, light, liquid, steam, beam, ring });
}

// ---- iron fence around the edge ----
{
  const R = CFG.worldRadius + 1.5;
  const count = Math.floor((Math.PI * 2 * R) / 1.6);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.05, 2.1, 5), ironMat, count);
  const tips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.08, 0.3, 4), ironMat, count);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, 0.05), ironMat, count * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * R, z = Math.sin(a) * R, y = heightAt(x, z);
    pts.push(new THREE.Vector3(x, y, z));
    q.setFromEuler(new THREE.Euler(rand(-0.06, 0.06), 0, rand(-0.06, 0.06)));
    m.compose(new THREE.Vector3(x, y + 1.05, z), q, new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, y + 2.2, z), q, new THREE.Vector3(1, 1, 1));
    tips.setMatrixAt(i, m);
  }
  for (let i = 0; i < count; i++) {
    const a = pts[i], b = pts[(i + 1) % count];
    const dir = b.clone().sub(a), len = dir.length();
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
    for (const [j, h] of [[0, 0.5], [1, 1.75]]) {
      m.compose(a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, h, 0)), q, new THREE.Vector3(len, 1, 1));
      rails.setMatrixAt(i * 2 + j, m);
    }
  }
  scene.add(posts, tips, rails);
}

// ---- graveyard ----
const graveSpots = [];
{
  const graveGeos = [0, 1, 2, 3].map(makeGraveGeo);
  const moundGeo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  function addGrave(x, z, rotY) {
    const type = rng() < 0.45 ? 0 : rng() < 0.5 ? 1 : rng() < 0.6 ? 3 : 2;
    const y = heightAt(x, z);
    const mesh = new THREE.Mesh(graveGeos[type], stoneMat);
    mesh.position.set(x, y - 0.05, z);
    mesh.rotation.set(rand(-0.12, 0.12), rotY + rand(-0.2, 0.2), rand(-0.15, 0.15));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    occluders.push(mesh);
    addCircle(x, z, type === 2 ? 0.45 : 0.55);
    const mx = x + Math.sin(rotY) * 1.2, mz = z + Math.cos(rotY) * 1.2;
    const mound = new THREE.Mesh(moundGeo, dirtMat);
    mound.scale.set(0.55, 0.18, 1.1);
    mound.position.set(mx, heightAt(mx, mz) - 0.02, mz);
    mound.rotation.y = rotY;
    mound.receiveShadow = true;
    scene.add(mound);
    graveSpots.push({ x: mx, z: mz, rotY });
  }
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 8; col++) {
      if (rng() < 0.18) continue;
      const x = 12 + col * 3.2 + rand(-0.5, 0.5);
      const z = 4 + row * 4 + rand(-0.4, 0.4);
      if (isFree(x, z, 0.8)) addGrave(x, z, Math.PI + rand(-0.15, 0.15));
    }
  }
  for (let i = 0; i < 16; i++) {
    const x = rand(-34, -14), z = rand(10, 30);
    if (isFree(x, z, 1.2)) addGrave(x, z, rand(0, Math.PI * 2));
  }
  for (let i = 0; i < 26; i++) {
    const a = rand(0, Math.PI * 2), r = rand(10, 50);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isFree(x, z, 1.2, { minCenter: 9 })) addGrave(x, z, rand(0, Math.PI * 2));
  }
}

// ---- dead trees ----
{
  // a few huge, gnarled old trees
  const giantGeos = Array.from({ length: 4 }, () => makeTreeGeo(5, [8, 11], 6, [0.8, 1.15]));
  for (let i = 0, tries = 0; i < 10 && tries < 600; tries++) {
    const a = rand(0, Math.PI * 2), r = rand(14, CFG.worldRadius - 5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isFree(x, z, 4, { minCenter: 12 })) continue;
    const geo = giantGeos[i % giantGeos.length];
    const { bark: t, leaves } = treeMeshes(geo);
    t.add(leaves);
    const sc = rand(0.95, 1.2);
    t.scale.set(sc, sc * rand(0.95, 1.1), sc);
    t.position.set(x, heightAt(x, z) - 0.2, z);
    t.rotation.y = rand(0, Math.PI * 2);
    scene.add(t);
    occluders.push(t);
    addCircle(x, z, geo.r * sc + 0.15, 14);
    i++;
  }
  const treeGeos = Array.from({ length: 10 }, (_, i) => makeTreeGeo(4, [3.2, 6], 7, i < 3 ? [0.14, 0.24] : i < 7 ? [0.25, 0.42] : [0.45, 0.65]));
  let placed = 0;
  for (let tries = 0; placed < 55 && tries < 2000; tries++) {
    const a = rand(0, Math.PI * 2), r = Math.sqrt(rng()) * (CFG.worldRadius - 2);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isFree(x, z, 2.2, { minCenter: 9 })) continue;
    const geo = treeGeos[placed % treeGeos.length];
    const { bark: t, leaves } = treeMeshes(geo);
    t.add(leaves);
    const s = rand(0.85, 1.5);
    t.scale.set(s, s * rand(0.85, 1.25), s);
    t.position.set(x, heightAt(x, z) - 0.1, z);
    t.rotation.y = rand(0, Math.PI * 2);
    t.castShadow = true;
    scene.add(t);
    occluders.push(t);
    addCircle(x, z, geo.r * s + 0.1, 8);
    placed++;
  }
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rand(-0.04, 0.04), r = rand(60, 95);
    const { bark: t, leaves } = treeMeshes(treeGeos[i % treeGeos.length]);
    t.add(leaves);
    t.castShadow = leaves.castShadow = false;
    t.scale.setScalar(rand(1.6, 2.8));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    t.position.set(x, heightAt(x, z) - 0.2, z);
    t.rotation.y = rand(0, Math.PI * 2);
    scene.add(t);
  }
}

// ---- dense forest patches (instanced so hundreds of trees stay cheap) ----
const FORESTS = [[-44, -21, 9], [14, -42, 8.5], [45, -7, 7.5], [-27, 41, 8.5], [25, 41, 8.5], [-8, -24, 6]];
{
  const geos = Array.from({ length: 6 }, (_, i) => makeTreeGeo(3, [5, 8.5], 9, [[0.15, 0.22], [0.22, 0.32], [0.3, 0.42], [0.4, 0.55], [0.18, 0.3], [0.55, 0.75]][i]));
  const placements = geos.map(() => []);
  const bushes = [], shrooms = [];
  for (const [fx, fz, fr] of FORESTS) {
    let placed = 0;
    for (let tries = 0; tries < 1500 && placed < 75; tries++) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(rng()) * fr;
      const x = fx + Math.cos(a) * r, z = fz + Math.sin(a) * r;
      const sc = rand(0.75, 1.45);
      if (!isFree(x, z, 0.75, { minCenter: 8 })) continue;
      placements[placed % geos.length].push({ x, z, s: sc, rot: rand(0, Math.PI * 2) });
      addCircle(x, z, geos[placed % geos.length].r * sc + 0.08, 9);
      placed++;
    }
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(rng()) * (fr + 1.5);
      bushes.push([fx + Math.cos(a) * r, fz + Math.sin(a) * r, rand(0.4, 1.0)]);
    }
    for (let i = 0; i < 45; i++) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(rng()) * fr;
      shrooms.push([fx + Math.cos(a) * r, fz + Math.sin(a) * r, rand(0.6, 1.4)]);
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  geos.forEach((g, gi) => {
    const list = placements[gi];
    if (!list.length) return;
    const { bark: im, leaves } = treeMeshes(g, list.length);
    list.forEach((p, i) => {
      q.setFromEuler(e.set(rand(-0.05, 0.05), p.rot, rand(-0.05, 0.05)));
      m.compose(new THREE.Vector3(p.x, heightAt(p.x, p.z) - 0.15, p.z), q, new THREE.Vector3(p.s, p.s * rand(0.9, 1.25), p.s));
      im.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
    });
    im.computeBoundingSphere();
    leaves.computeBoundingSphere();
    scene.add(im, leaves);
    occluders.push(im);
  });
  // dead undergrowth
  const bushGeo = new THREE.IcosahedronGeometry(1, 0);
  const bush = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0x16120c, roughness: 1, flatShading: true }), bushes.length);
  bushes.forEach(([x, z, sc], i) => {
    q.setFromEuler(e.set(rand(0, 3), rand(0, 3), rand(0, 3)));
    m.compose(new THREE.Vector3(x, heightAt(x, z) + sc * 0.2, z), q, new THREE.Vector3(sc * 1.2, sc * 0.6, sc));
    bush.setMatrixAt(i, m);
  });
  scene.add(bush);
  // faintly glowing toadstools
  const capGeo = new THREE.SphereGeometry(0.09, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.12, 5); stemGeo.translate(0, -0.06, 0);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0x4dffd2 }), shrooms.length);
  const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshBasicMaterial({ color: 0x9adfc8 }), shrooms.length);
  shrooms.forEach(([x, z, sc], i) => {
    m.compose(new THREE.Vector3(x, heightAt(x, z) + 0.12 * sc, z), q.identity(), new THREE.Vector3(sc, sc, sc));
    caps.setMatrixAt(i, m); stems.setMatrixAt(i, m);
  });
  scene.add(caps, stems);
}

// ---- thickets of leafy bushes that sway in the wind ----
const bushes = [];   // {x, z, y, r, h}: soft, they block sight and slow you down
{
  const THICKETS = [[-12, 16, 6], [34, -12, 6], [-38, 8, 6], [6, 28, 6], [40, 22, 6], [-20, -40, 6], [30, -40, 5], [-48, 24, 5], [10, -14, 4.5], [-24, -8, 5]];
  const geos = Array.from({ length: 6 }, (_, i) => makeBushGeo(0.9 + i * 0.22));
  const placements = geos.map(() => []);
  const tryBush = (x, z) => {
    if (!isFree(x, z, 0.5, { minCenter: 7 })) return false;
    const gi = (rng() * geos.length) | 0, sc = rand(0.85, 1.35);
    const r = geos[gi].r * sc;
    if (bushes.some((b) => Math.hypot(b.x - x, b.z - z) < (b.r + r) * 0.8)) return false;
    const y = heightAt(x, z);
    placements[gi].push({ x, z, y, sc, rot: rand(0, Math.PI * 2) });
    bushes.push({ x, z, y, r, h: geos[gi].h * sc });
    return true;
  };
  for (const [tx, tz, tr] of THICKETS) {
    for (let k = 0, n = 0; k < 120 && n < 32; k++) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(rng()) * tr;
      if (tryBush(tx + Math.cos(a) * r, tz + Math.sin(a) * r)) n++;
    }
  }
  for (const [fx, fz, fr] of FORESTS) {   // leafy undergrowth in the forests
    for (let k = 0, n = 0; k < 80 && n < 14; k++) {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(rng()) * (fr + 2);
      if (tryBush(fx + Math.cos(a) * r, fz + Math.sin(a) * r)) n++;
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  geos.forEach((g, gi) => {
    const list = placements[gi];
    if (!list.length) return;
    const stems = new THREE.InstancedMesh(g.bark, bushStemMat, list.length);
    const leaves = new THREE.InstancedMesh(g.leaves, bushLeafMat, list.length);
    list.forEach((p, i) => {
      q.setFromEuler(e.set(0, p.rot, 0));
      m.compose(new THREE.Vector3(p.x, p.y - 0.05, p.z), q, new THREE.Vector3(p.sc, p.sc * rand(0.85, 1.15), p.sc));
      stems.setMatrixAt(i, m); leaves.setMatrixAt(i, m);
    });
    stems.computeBoundingSphere(); leaves.computeBoundingSphere();
    scene.add(stems, leaves);
  });
}
function bushAt(x, z, y, shrink = 1) {
  for (const b of bushes) {
    const dx = x - b.x, dz = z - b.z, r = b.r * shrink;
    if (dx * dx + dz * dz < r * r && y > b.y - 0.2 && y < b.y + b.h) return b;
  }
  return null;
}

// ---- jack-o'-lanterns ----
const pumpkins = [];
{
  const geo = makePumpkinGeo();
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.25, 6);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3a3a16, roughness: 1 });
  let lightsLeft = 5;
  function addPumpkin(x, z, s, faceTo, withLight = false, y = heightAt(x, z)) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe0661a, roughness: 0.55, emissive: 0xff8a2a,
      emissiveMap: pumpkinFaces[(rng() * 3) | 0], emissiveIntensity: 2.4,
    });
    const g = new THREE.Group();
    const body = new THREE.Mesh(geo, mat);
    body.position.y = 0.78 * s; body.scale.setScalar(s); body.castShadow = true;
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = 1.6 * s; stem.scale.setScalar(s * 1.6); stem.rotation.z = rand(-0.4, 0.4);
    g.add(body, stem);
    g.position.set(x, y, z);
    g.rotation.y = faceTo !== undefined ? faceTo : rand(0, Math.PI * 2);
    scene.add(g);
    let light = null;
    if (withLight && lightsLeft > 0) {
      lightsLeft--;
      light = new THREE.PointLight(0xff7a20, 9, 9, 1.8);
      light.position.set(x, y + 1.0 * s + 0.4, z);
      scene.add(light);
      lightZones.push({ pos: light.position.clone(), r: 3.6 });
    }
    addCircle(x, z, s * 0.9, 1.5, y);
    pumpkins.push({ mat, light, base: rand(2.0, 2.8), phase: rand(0, 100) });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 3.2, z = Math.sin(a) * 3.2;
    addPumpkin(x, z, 0.32, Math.atan2(-x, -z));
  }
  for (const r of pumpkinRequests) addPumpkin(r.p.x, r.p.z, r.s, r.face, r.light, r.p.y);
  for (const [x, z] of [[22, 2], [-22, 22], [8, -30], [-41, -5]]) {
    if (isFree(x, z, 1.2)) addPumpkin(x, z, rand(0.4, 0.55), Math.atan2(-x, -z), true);
  }
  for (let i = 0; i < 18; i++) {
    const a = rand(0, Math.PI * 2), r = rand(9, 50);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isFree(x, z, 1)) addPumpkin(x, z, rand(0.25, 0.5), Math.atan2(-x, -z));
  }
}

// ---- will-o'-wisps ----
const wisps = (() => {
  const n = 260, pos = new Float32Array(n * 3), seeds = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 52;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    seeds.push({ x, z, y: heightAt(x, z) + rrand(0.4, 3), p: Math.random() * 100, s: rrand(0.2, 0.6) });
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    map: glowTex, color: 0x7dffb0, size: 0.35, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(pts);
  return { g, seeds, pos };
})();

// ---- bats ----
const bats = [];
{
  const batMat = new THREE.MeshBasicMaterial({ color: 0x050307, side: THREE.DoubleSide });
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(0.5, 0.15); wingShape.lineTo(0.75, 0.05); wingShape.lineTo(0.6, -0.08);
  wingShape.lineTo(0.45, 0.0); wingShape.lineTo(0.3, -0.1); wingShape.lineTo(0.15, -0.02); wingShape.lineTo(0, -0.08);
  const wingGeo = new THREE.ShapeGeometry(wingShape); wingGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 22; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), batMat); body.scale.set(0.8, 0.8, 1.4);
    const wl = new THREE.Group(), wr = new THREE.Group();
    const ml = new THREE.Mesh(wingGeo, batMat); ml.scale.x = -1; wl.add(ml);
    const mr = new THREE.Mesh(wingGeo, batMat); wr.add(mr);
    g.add(body, wl, wr);
    g.scale.setScalar(rrand(0.9, 1.5));
    scene.add(g);
    const cx = rrand(-40, 40), cz = rrand(-40, 40);
    bats.push({ g, wl, wr, cx, cz, r: rrand(6, 18), h: rrand(9, 17) + Math.max(0, heightAt(cx, cz)), sp: rrand(0.4, 0.9) * (Math.random() < 0.5 ? -1 : 1), p: Math.random() * 10 });
  }
}

// ---- loose leaves drifting down around you ----
const fallingLeaves = (() => {
  const n = LOW_POWER ? 110 : 220;
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshStandardMaterial({
    map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9,
  }), n);
  const items = [];
  for (let i = 0; i < n; i++) {
    im.setColorAt(i, LEAF_COLORS[i % LEAF_COLORS.length]);
    items.push({ p: new THREE.Vector3(0, -100, 0), spin: new THREE.Vector3(rrand(-3, 3), rrand(-3, 3), rrand(-3, 3)), r: new THREE.Euler(), fall: rrand(0.5, 1.1), ph: Math.random() * 10 });
  }
  im.frustumCulled = false;
  scene.add(im);
  return { im, items };
})();

// ============================================================================
// Characters
// ============================================================================
function makeElf({ real = true } = {}) {
  const root = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xa30c12, roughness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xece8e4, roughness: 0.95, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1ccb0, roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({
    map: elfFaceTex, emissiveMap: elfEyeGlowTex, emissive: 0xff1a00, emissiveIntensity: real ? 4 : 0.5, roughness: 0.65,
  });
  const body = new THREE.Group(); root.add(body);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.25, 0.62, 14), red);
  torso.position.y = 1.0; body.add(torso);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), red);
  belly.scale.y = 0.55; belly.position.y = 0.72; body.add(belly);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.36, 0.1, 9), white);
  collar.position.y = 1.33; body.add(collar);
  const headPivot = new THREE.Group(); headPivot.position.y = 1.38; body.add(headPivot);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 40, 24), headMat);
  head.position.y = 0.27; headPivot.add(head);
  const earGeo = new THREE.ConeGeometry(0.06, 0.22, 8);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, skin);
    ear.rotation.z = -s * (Math.PI / 2 - 0.4);
    ear.position.set(s * 0.32, 0.3, -0.02);
    headPivot.add(ear);
  }
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.315, 0.8, 24), red);
  hat.position.set(0, 0.8, -0.06); hat.rotation.x = -0.32;
  headPivot.add(hat);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), red);
  tip.position.set(0, 1.18, -0.2); headPivot.add(tip);
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.11, 0.72, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.66, 8), red);
    leg.position.y = -0.33; hip.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), red);
    foot.scale.set(1, 0.7, 1.7); foot.position.set(0, -0.68, 0.05); hip.add(foot);
    body.add(hip); legs.push(hip);
    const sh = new THREE.Group(); sh.position.set(s * 0.25, 1.24, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.62, 8), red);
    arm.position.y = -0.31; sh.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), skin);
    hand.position.y = -0.65; sh.add(hand);
    sh.rotation.z = s * 0.18;
    body.add(sh); arms.push(sh);
  }
  const eyes = [];
  if (real) {
    for (const [px, py] of ELF_PUPILS) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xff2200, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      sp.scale.setScalar(0.22);
      sp.position.copy(spherePoint(px / 512, py / 256, 0.31)).add(new THREE.Vector3(0, 0.27, 0));
      headPivot.add(sp); eyes.push(sp);
    }
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, headPivot, legs, arms, eyes, headMat };
}

function makePlayer() {
  const root = new THREE.Group();
  const cloak = new THREE.MeshStandardMaterial({ color: 0x3c2560, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141018, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b996, roughness: 0.7 });
  const body = new THREE.Group(); root.add(body);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.8, 12), cloak);
  torso.position.y = 1.0; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), skin);
  head.position.y = 1.55; body.add(head);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 20), dark);
  brim.position.y = 1.68; body.add(brim);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.6, 16), dark);
  hat.position.set(0, 1.98, -0.04); hat.rotation.x = -0.25; body.add(hat);
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.11, 0.62, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.62, 8), dark);
    leg.position.y = -0.31; hip.add(leg); body.add(hip); legs.push(hip);
    const sh = new THREE.Group(); sh.position.set(s * 0.27, 1.3, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.55, 8), cloak);
    arm.position.y = -0.27; sh.add(arm); body.add(sh); arms.push(sh);
  }
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0x401000 }));
  bucket.position.y = -0.62; arms[0].add(bucket);
  const flash = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.28, 8), ironMat);
  flash.rotation.x = Math.PI / 2; flash.position.set(0, -0.56, 0.1); arms[1].add(flash);
  const lens = new THREE.Object3D(); lens.position.set(0, -0.56, 0.26); arms[1].add(lens);
  root.scale.setScalar(0.92);
  return { root, body, legs, arms, lens };
}

const elf = makeElf({ real: true });
scene.add(elf.root);
const player = makePlayer();
scene.add(player.root);

// Decoy elves sitting on little shelves. Their heads turn when you aren't looking.
function addDecoy(pos, rotY, small = false) {
  const shelf = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.6), darkWoodMat); top.position.y = 1.2;
  const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.5), darkWoodMat); l1.position.set(-0.55, 0.6, 0);
  const l2 = l1.clone(); l2.position.x = 0.55;
  shelf.add(top, l1, l2);
  const e = makeElf({ real: false });
  e.root.scale.setScalar(0.45);
  e.root.position.set(0, 1.25 - 0.72 * 0.45 + 0.02, 0.05);
  for (const leg of e.legs) leg.rotation.x = -1.5;
  for (const arm of e.arms) arm.rotation.x = -0.3;
  shelf.add(e.root);
  shelf.position.copy(pos);
  shelf.rotation.y = rotY;
  if (small) shelf.scale.setScalar(0.85);
  scene.add(shelf);
  addCircle(pos.x, pos.z, 0.8, 1.5, pos.y);
  decoys.push({ e, shelf });
}
for (const d of decoyRequests) addDecoy(d.pos, d.rotY, d.small);
for (const [x, z] of [[16, 26.5], [-38, 4], [36, 14], [8, -38], [-12, -14], [28, -10]]) {
  if (isFree(x, z, 1.1)) addDecoy(new THREE.Vector3(x, heightAt(x, z), z), Math.atan2(-x, -z));
}

// ---- Ghosts: drift through walls, vanish in your flashlight ----
function makeGhost() {
  const prof = [[0.62, -0.5], [0.55, -0.1], [0.47, 0.3], [0.45, 0.55], [0.4, 0.78], [0.28, 0.95], [0.12, 1.03], [0, 1.05]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(prof, 28);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -0.45) p.setY(i, y + 0.12 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 7));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xdfe8ff, emissive: 0x8fa8ff, emissiveIntensity: 0.7, transparent: true, opacity: 0.6,
    side: THREE.DoubleSide, depthWrite: false, roughness: 0.6,
  });
  const root = new THREE.Group();
  const body = new THREE.Mesh(geo, mat);
  root.add(body);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), holeMat);
    eye.scale.y = 1.5; eye.position.set(s * 0.14, 0.72, 0.425);
    root.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), holeMat);
  mouth.scale.y = 1.4; mouth.position.set(0, 0.45, 0.455);
  root.add(mouth);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x8fb0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(3); glow.position.y = 0.4;
  root.add(glow);
  scene.add(root);
  return { root, mat, holeMat, glow };
}
const ghosts = Array.from({ length: CFG.ghostCount }, () => ({ ...makeGhost(), pos: new THREE.Vector3(), vel: new THREE.Vector3() }));

// ---- Skeletons: climb out of their graves when you pass ----
function makeSkeleton() {
  const bone = new THREE.MeshStandardMaterial({ color: 0xd9d0b6, roughness: 0.8 });
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), new THREE.MeshStandardMaterial({ map: skullTex, roughness: 0.8 }));
  skull.scale.set(1, 1.1, 1.05); skull.position.y = 1.64;
  body.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.12), bone);
  jaw.position.set(0, 1.5, 0.06); body.add(jaw);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 6), bone);
  spine.position.y = 1.18; body.add(spine);
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.16 - i * 0.012, 0.016, 5, 16, Math.PI * 1.5), bone);
    rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.75 - Math.PI / 2);
    rib.position.set(0, 1.42 - i * 0.09, 0.02);
    body.add(rib);
  }
  const pelvis = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 12), bone);
  pelvis.rotation.x = Math.PI / 2; pelvis.position.y = 0.9; body.add(pelvis);
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0.88, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.86, 6), bone);
    leg.position.y = -0.43; hip.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.2), bone);
    foot.position.set(0, -0.86, 0.05); hip.add(foot);
    body.add(hip); legs.push(hip);
    const sh = new THREE.Group(); sh.position.set(s * 0.2, 1.45, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.62, 6), bone);
    arm.position.y = -0.31; sh.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), bone);
    hand.position.y = -0.64; sh.add(hand);
    body.add(sh); arms.push(sh);
  }
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6dff8f, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    e.scale.setScalar(0.12); e.position.set(s * 0.06, 1.66, 0.15);
    body.add(e); eyes.push(e);
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(root);
  return { root, body, legs, arms, jaw };
}
const skeletons = [];
{
  const pool = graveSpots.filter((g) => Math.hypot(g.x, g.z) > 12).sort(() => rng() - 0.5);
  for (const g of pool) {
    if (skeletons.length >= CFG.skeletonCount) break;
    if (skeletons.some((s) => Math.hypot(s.home.x - g.x, s.home.z - g.z) < 8)) continue;
    skeletons.push({ ...makeSkeleton(), home: g, pos: new THREE.Vector3(), vy: 0 });
  }
}

// ---- Spiders: lurk upstairs, drop from the ceiling ----
function makeSpider() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x0d0b0b, roughness: 0.45 });
  const root = new THREE.Group();
  const abd = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), mat);
  abd.scale.set(1, 0.75, 1.25); abd.position.set(0, 0.65, -0.55); root.add(abd);
  const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), new THREE.MeshStandardMaterial({ color: 0xaa0000, emissive: 0x550000 }));
  mark.scale.set(1, 0.3, 1.7); mark.position.set(0, 1.02, -0.55); root.add(mark);
  const ceph = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat);
  ceph.scale.set(1, 0.7, 1.1); ceph.position.set(0, 0.55, 0.2); root.add(ceph);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1a00 });
  for (const [x, y, r] of [[-0.07, 0.66, 0.05], [0.07, 0.66, 0.05], [-0.15, 0.62, 0.03], [0.15, 0.62, 0.03], [-0.04, 0.6, 0.025], [0.04, 0.6, 0.025]]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), eyeMat);
    e.position.set(x, y, 0.5); root.add(e);
  }
  for (const s of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 6), mat);
    fang.rotation.x = Math.PI; fang.position.set(s * 0.06, 0.42, 0.48); root.add(fang);
  }
  const legs = [];
  const upperGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.7, 6); upperGeo.rotateZ(Math.PI / 2);
  const lowerGeo = new THREE.CylinderGeometry(0.015, 0.035, 1.1, 6); lowerGeo.rotateZ(Math.PI / 2);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.2, 0.55, 0.35 - i * 0.18);
      const baseYaw = -s * (0.7 - i * 0.45);
      hip.rotation.set(0, baseYaw, s * 0.6, 'YXZ');
      const up = new THREE.Mesh(upperGeo, mat); up.position.x = s * 0.35; hip.add(up);
      const knee = new THREE.Group(); knee.position.x = s * 0.7; knee.rotation.z = -s * 1.6; hip.add(knee);
      const low = new THREE.Mesh(lowerGeo, mat); low.position.x = s * 0.55; knee.add(low);
      root.add(hip);
      legs.push({ hip, knee, baseYaw, s, i });
    }
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(root);
  const thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 }));
  scene.add(thread);
  return { root, legs, thread };
}
const spiders = houses.map((h) => ({ ...makeSpider(), house: h, pos: new THREE.Vector3() }));

// ---- flashlight ----
const flashlight = new THREE.SpotLight(0xfff0cf, 140, CFG.flashRange, 0.4, 0.45, 1.7);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(LOW_POWER ? 512 : 1024, LOW_POWER ? 512 : 1024);
flashlight.shadow.camera.near = 0.3;
flashlight.shadow.camera.far = CFG.flashRange;
flashlight.shadow.bias = -0.0005;
scene.add(flashlight, flashlight.target);

// ---- collectibles ----
const candies = [];
const batteries = [];
{
  const candyGeo = new THREE.ConeGeometry(0.22, 0.5, 20);
  candyGeo.rotateX(Math.PI);
  const candyMat = new THREE.MeshBasicMaterial({ map: candyTex });
  for (let i = 0; i < CFG.candyCount; i++) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(candyGeo, candyMat);
    m.scale.setScalar(1.3);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a10, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(2);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.5, 60, 12, 1, true), new THREE.MeshBasicMaterial({
      color: 0xff7a10, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    beam.position.y = 30;
    g.add(m, glow, beam);
    scene.add(g);
    candies.push({ g, m, taken: false });
  }
  const batGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.38, 12);
  const batMat = new THREE.MeshBasicMaterial({ color: 0x8dff4a });
  for (let i = 0; i < houses.length + 4; i++) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(batGeo, batMat); m.rotation.z = 0.4;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), ironMat); cap.position.y = 0.22; m.add(cap);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9dff4a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.3);
    g.add(m, glow);
    scene.add(g);
    batteries.push({ g, m, taken: false });
  }
}

function scatterPickups() {
  const used = [];
  const pick = (minC, maxC, sep) => {
    for (let t = 0; t < 400; t++) {
      const a = Math.random() * Math.PI * 2, r = rrand(minC, maxC);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!isFree(x, z, 1.0)) continue;
      if (used.some((u) => Math.hypot(u.x - x, u.z - z) < sep)) continue;
      used.push({ x, z });
      return new THREE.Vector3(x, heightAt(x, z), z);
    }
    return new THREE.Vector3(10, heightAt(10, 10), 10);
  };
  for (const h of houses) used.push({ x: h.footprint.cx, z: h.footprint.cz });
  candies.forEach((c, i) => {
    const p = i < houses.length ? houses[i].candySpot : pick(12, 50, 13);
    c.g.position.set(p.x, p.y + 1.1, p.z); c.taken = false; c.g.visible = true;
  });
  batteries.forEach((b, i) => {
    const p = i < houses.length ? houses[i].batterySpot : pick(8, 48, 8);
    b.g.position.set(p.x, p.y + 0.6, p.z); b.taken = false; b.g.visible = true;
  });
}

// ============================================================================
// Audio (all procedural, no files)
// ============================================================================
// ============================================================================
// Music: a playlist of creepy tunes (all public domain melodies), synthesized live.
// Notation: NOTE+OCTAVE/BEATS, chords joined with +, R = rest. e.g. "Bb4/1 D4+F4+A4/2 R/.5"
// ============================================================================
const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(n) {
  const m = n.match(/^([A-G])(#|b)?(-?\d)$/);
  return 12 * (Number(m[3]) + 1) + NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
function parseSeq(str) {
  return str.trim().split(/\s+/).map((tok) => {
    const [n, d] = tok.split('/');
    return [n === 'R' ? null : n.split('+').map(noteToMidi), parseFloat(d)];
  });
}
const rpt = (str, n) => Array(n).fill(str).join(' ');

const TRACKS = [
  {
    name: 'Jingle Bells (in a minor key)', desc: 'Christmas · broken music box', bpm: 120, loops: 2,
    parts: [{ voice: 'musicbox', seq: 'Eb5/1 Eb5/1 Eb5/2 Eb5/1 Eb5/1 Eb5/2 Eb5/1 G5/1 C5/1.5 D5/.5 Eb5/4 F5/1 F5/1 F5/1.5 F5/.5 F5/1 Eb5/1 Eb5/1 Eb5/.5 Eb5/.5 Eb5/1 D5/1 D5/1 Eb5/1 D5/2 G5/2 Eb5/1 Eb5/1 Eb5/2 Eb5/1 Eb5/1 Eb5/2 Eb5/1 G5/1 C5/1.5 D5/.5 Eb5/4 F5/1 F5/1 F5/1.5 F5/.5 F5/1 Eb5/1 Eb5/1 Eb5/.5 Eb5/.5 G5/1 G5/1 F5/1 D5/1 C5/4 R/4' }],
  },
  {
    name: 'Carol of the Bells', desc: 'Christmas · celesta, cellos and tolling bells', bpm: 156, loops: 2,
    parts: [
      { voice: 'celesta', seq: rpt('Bb5/1 A5/.5 Bb5/.5 G5/1', 16) },
      { voice: 'strings', gain: 0.8, seq: rpt('G2/3 F2/3 Eb2/3 D2/3', 4) },
      { voice: 'bell', gain: 0.8, seq: 'R/24 D5/3 C5/3 Bb4/3 A4/3 G4/3 A4/3 Bb4/3 D5/3' },
    ],
  },
  {
    name: 'Silent Night (out of tune)', desc: 'Christmas · warped toy piano', bpm: 96, loops: 2,
    parts: [
      { voice: 'toypiano', seq: 'G4/1.5 Ab4/.5 G4/1 Eb4/3 G4/1.5 Ab4/.5 G4/1 Eb4/3 D5/2 D5/1 Bb4/3 C5/2 C5/1 G4/3 ' +
        'Ab4/2 Ab4/1 C5/1.5 Bb4/.5 Ab4/1 G4/1.5 Ab4/.5 G4/1 Eb4/3 Ab4/2 Ab4/1 C5/1.5 Bb4/.5 Ab4/1 G4/1.5 Ab4/.5 G4/1 Eb4/3 ' +
        'D5/2 D5/1 F5/1.5 D5/.5 Bb4/1 C5/3 Eb5/3 C5/1.5 G4/.5 Eb4/1 G4/1.5 F4/.5 D4/1 C4/6' },
      { voice: 'pad', gain: 0.9, seq: 'C3+Eb3+G3/12 G2+D3+G3/6 C3+Eb3+G3/6 F2+Ab2+C3/6 C3+Eb3+G3/6 F2+Ab2+C3/6 C3+Eb3+G3/6 G2+B2+D3/6 C3+Eb3+G3/6 G2+B2+D3/6 C3+Eb3+G3/6' },
    ],
  },
  {
    name: 'We Wish You a Merry Christmas (winding down)', desc: 'Christmas · a music box running down', bpm: 132, loops: 3, windDown: true,
    parts: [
      { voice: 'musicbox', seq: 'D4/1 G4/1 G4/.5 A4/.5 G4/.5 F#4/.5 Eb4/1 C4/1 Eb4/1 A4/1 A4/.5 Bb4/.5 A4/.5 G4/.5 F#4/1 D4/1 D4/1 ' +
        'Bb4/1 Bb4/.5 C5/.5 Bb4/.5 A4/.5 G4/1 Eb4/1 D4/.5 D4/.5 Eb4/1 A4/1 F#4/1 G4/2 R/1' },
      { voice: 'pizz', gain: 0.6, seq: 'R/1 G2/1 D3/1 D3/1 C3/1 G3/1 G3/1 D3/1 A3/1 A3/1 G2/1 D3/1 D3/1 Eb3/1 Bb3/1 Bb3/1 C3/1 G3/1 G3/1 D3/1 A3/1 A3/1 G2/1 D3/1 D3/1' },
    ],
  },
  {
    name: 'In the Hall of the Mountain King', desc: 'Halloween · bassoon and plucked strings, getting faster', bpm: 84, loops: 6, accel: 1.16,
    parts: [
      { voice: 'bassoon', seq: 'B3/.5 C#4/.5 D4/.5 E4/.5 F#4/.5 D4/.5 F#4/1 F4/.5 C#4/.5 F4/1 E4/.5 C4/.5 E4/1 ' +
        'B3/.5 C#4/.5 D4/.5 E4/.5 F#4/.5 D4/.5 F#4/.5 B4/.5 A4/.5 F#4/.5 D4/.5 F#4/.5 A4/2' },
      { voice: 'pizz', gain: 0.8, seq: rpt('B2/1 F#2/1', 8) },
    ],
  },
  {
    name: 'Toccata and Fugue in D minor', desc: 'Halloween · pipe organ', bpm: 66, loops: 1, gap: 6,
    parts: [
      { voice: 'organ', seq: 'A5/.15 G5/.15 A5/1.4 R/.6 G5/.2 F5/.2 E5/.2 D5/.2 C#5/1 D5/2.2 R/1.2 ' +
        'A4/.15 G4/.15 A4/1.4 R/.6 E4/.4 F4/.4 C#4/.6 D4/2.2 R/1.2 ' +
        'A3/.15 G3/.15 A3/1.4 R/.6 G3/.2 F3/.2 E3/.2 D3/.2 C#3/1 D3/2.2 R/1 ' +
        'D2/.5 C#3+E3/.5 C#3+E3+G3/.5 C#3+E3+G3+Bb3/.5 C#3+E3+G3+Bb3+E4/3 D3+F3+A3+D4/6 R/2 ' +
        'A4/.15 G4/.15 A4/.4 E4/.25 F4/.25 C#4/.25 D4/.5 A4/.15 G4/.15 A4/.4 E4/.25 F4/.25 C#4/.25 D4/.5 ' +
        'D2+A2+D3+F3+A3+D4/8' },
    ],
  },
  {
    name: 'Funeral March (Chopin)', desc: 'Halloween · church bells and organ', bpm: 50, loops: 2,
    parts: [
      { voice: 'bell', seq: rpt('Bb3/1 Bb3/.75 Bb3/.25 Bb3/2 Db4/.75 C4/.25 C4/.75 Bb3/.25 Bb3/.75 A3/.25 Bb3/1', 2) },
      { voice: 'organ', gain: 0.8, seq: rpt('Bb1+F2+Db3/2 Gb1+Db2+Bb2/2', 4) },
    ],
  },
  {
    name: 'Dies Irae (theremin)', desc: 'Halloween · theremin and ghostly choir', bpm: 72, loops: 2,
    parts: [
      { voice: 'theremin', seq: 'F4/1 E4/1 F4/1 D4/1 E4/1 C4/1 D4/2 F4/1 F4/1 G4/1 F4/1 E4/1 D4/1 C4/1 D4/1 ' +
        'A3/1 G3/1 A3/1 F3/1 G3/1 E3/1 F3/2 F4/1 E4/1 F4/1 D4/1 E4/1 C4/1 D4/2' },
      { voice: 'choir', seq: 'D3+F3+A3/8 Bb2+D3+F3/8 A2+C#3+E3/8 D3+F3+A3/8' },
      { voice: 'pizz', gain: 0.5, seq: rpt('D2/2 A2/2', 4) + ' ' + rpt('A1/2 E2/2', 2) + ' ' + rpt('D2/2 A2/2', 2) },
    ],
  },
];

class AudioEngine {
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0.9;
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // music bus: dry + a big cathedral-ish reverb
    this.musicGain = c.createGain(); this.musicGain.gain.value = 0.0; this.musicGain.connect(this.master);
    const rev = c.createConvolver(), wet = c.createGain();
    const irLen = c.sampleRate * 3.5, ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3);
    }
    rev.buffer = ir; wet.gain.value = 0.5;
    this.musicGain.connect(rev); rev.connect(wet); wet.connect(this.master);
    this.musicDetune = 0;
    this.musicLevel = 0; this.musicMuted = false;
    this.startAmbience();
    // Jingle Bells first, then the rest shuffled
    this.playlist = [0, ...TRACKS.slice(1).map((_, i) => i + 1).sort(() => Math.random() - 0.5)];
    this.playPos = -1;
    this.nextTrack();
    this.setMusic(state === 'title' ? 0.35 : 0.55);
    applySettings();
  }
  get ok() { return this.ctx && this.ctx.state === 'running'; }
  noise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; return s; }
  env(g, t, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  startAmbience() {
    const c = this.ctx;
    const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 1.4; g.gain.value = 0.2;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 260;
    lfo.connect(lg); lg.connect(f.frequency);
    const lfo2 = c.createOscillator(), lg2 = c.createGain(); lfo2.frequency.value = 0.11; lg2.gain.value = 0.12;
    lfo2.connect(lg2); lg2.connect(g.gain);
    n.connect(f); f.connect(g); g.connect(this.amb);
    n.start(); lfo.start(); lfo2.start();
    const dg = c.createGain(), df = c.createBiquadFilter();
    dg.gain.value = 0.05; df.type = 'lowpass'; df.frequency.value = 160;
    for (const fr of [43.65, 44.1, 65.4]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(df); o.start(); }
    df.connect(dg); dg.connect(this.amb);
  }
  nextTrack() {
    if (!this.ctx) return;
    this.playPos = (this.playPos + 1) % this.playlist.length;
    const tr = TRACKS[this.playlist[this.playPos]];
    const t0 = this.ctx.currentTime + 0.4;
    tr.parts.forEach((p) => { p.notes = p.notes || parseSeq(p.seq); });
    this.track = tr;
    this.parts = tr.parts.map((p) => ({ ...p, idx: 0, next: t0, loop: 0, done: false, lastF: 0 }));
    this.musicPaused = false;
    this.setMusic(this.musicLevel);
    showNowPlaying(tr.name);
    renderJukebox();
  }
  playTrack(ti) {
    if (!this.ctx) return;
    this.playPos = this.playlist.indexOf(ti) - 1;
    this.nextTrack();
  }
  prevTrack() {
    if (!this.ctx) return;
    const n = this.playlist.length;
    this.playPos = (this.playPos - 2 + 2 * n) % n;
    this.nextTrack();
  }
  get currentTrack() { return this.ctx ? this.playlist[this.playPos] : -1; }
  togglePause() {
    if (!this.ctx) return;
    if (this.musicPaused) {
      const off = this.ctx.currentTime - this.pausedAt;
      for (const p of this.parts) p.next += off;   // carry on from where we stopped
      this.musicPaused = false;
    } else {
      this.musicPaused = true;
      this.pausedAt = this.ctx.currentTime;
    }
    this.setMusic(this.musicLevel);
    renderJukebox();
  }
  get progress() {
    if (!this.parts || !this.parts.length) return 0;
    const p = this.parts[0];
    return clamp(p.done ? 1 : (p.loop + p.idx / p.notes.length) / this.track.loops, 0, 1);
  }
  toggleMusic() {
    this.musicMuted = !this.musicMuted;
    this.setMusic(this.musicLevel);
    toast(this.musicMuted ? 'Music off' : 'Music on', 1.2, '#b78cff');
  }
  update(dt, proximity) {
    if (!this.ok || !this.track || this.musicPaused) return;
    const c = this.ctx, now = c.currentTime, tr = this.track;
    // the closer he is, the slower and more out of tune the music plays
    this.musicDetune = lerp(this.musicDetune, -proximity * 70, 0.05);
    const beat = (60 / tr.bpm) * (1 + proximity * 0.5);
    let allDone = true, end = 0;
    for (const p of this.parts) {
      if (!p.done && p.next < now - 0.5) p.next = now + 0.05;   // tab was in the background
      while (!p.done && p.next < now + 0.3) {
        const [notes, dur] = p.notes[p.idx];
        let stretch = 1;
        if (tr.accel) stretch /= Math.pow(tr.accel, p.loop);                                   // speeding up
        if (tr.windDown) stretch *= 1 + 0.45 * (p.loop + p.idx / p.notes.length) / tr.loops;   // running down
        const len = dur * beat * stretch;
        const extraDetune = tr.windDown ? -40 * (p.loop + p.idx / p.notes.length) / tr.loops : 0;
        if (notes) for (const m of notes) this.voice(p.voice, m, p.next, len, (p.gain ?? 1) / Math.sqrt(notes.length), p, extraDetune);
        p.next += len;
        if (++p.idx >= p.notes.length) { p.idx = 0; if (++p.loop >= tr.loops) p.done = true; }
      }
      if (!p.done) allDone = false;
      end = Math.max(end, p.next);
    }
    if (allDone && now > end + (tr.gap ?? 4)) this.nextTrack();
  }
  // Synth instruments
  voice(type, midi, t, len, vel, part, extraDetune = 0) {
    const c = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12);
    const out = c.createGain(); out.gain.value = vel; out.connect(this.musicGain);
    const det = this.musicDetune + extraDetune;
    const osc = (wave, freq, d = 0) => { const o = c.createOscillator(); o.type = wave; o.frequency.value = freq; o.detune.value = det + d; return o; };
    const env = (a, peak, hold, rel, dest = out) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.setValueAtTime(peak, t + a + Math.max(0, hold)); g.gain.exponentialRampToValueAtTime(0.0001, t + a + Math.max(0, hold) + rel);
      g.connect(dest); return { g, stop: t + a + Math.max(0, hold) + rel + 0.05 };
    };
    const partials = (wave, list, e, detJitter = 0) => {
      for (const [mult, amp] of list) {
        const o = osc(wave, f * mult, (Math.random() - 0.5) * detJitter), og = c.createGain();
        og.gain.value = amp; o.connect(og); og.connect(e.g); o.start(t); o.stop(e.stop);
      }
    };
    switch (type) {
      case 'musicbox': partials('sine', [[1, 1], [3.01, 0.18], [5.2, 0.06]], env(0.004, 0.22, 0, 1.8), 16); break;
      case 'celesta': partials('sine', [[1, 1], [2, 0.3], [4.02, 0.12]], env(0.003, 0.2, 0, 1.3), 10); break;
      case 'bell': partials('sine', [[1, 1], [2, 0.5], [2.76, 0.4], [5.4, 0.25], [8.93, 0.12]], env(0.004, 0.16, 0, 4.5), 6); break;
      case 'toypiano': {
        // warped and sagging, like an old tape
        const e = env(0.004, 0.22, 0, 1.0);
        for (const [mult, amp, wave] of [[1, 1, 'triangle'], [2.76, 0.25, 'sine'], [4.1, 0.08, 'sine']]) {
          const o = osc(wave, f * mult, (Math.random() - 0.5) * 40), og = c.createGain();
          o.frequency.setValueAtTime(f * mult * 1.006, t); o.frequency.linearRampToValueAtTime(f * mult * 0.992, t + 1);
          og.gain.value = amp; o.connect(og); og.connect(e.g); o.start(t); o.stop(e.stop);
        }
        break;
      }
      case 'organ': partials('sine', [[0.5, 0.3], [1, 0.6], [2, 0.4], [3, 0.2], [4, 0.15], [6, 0.08], [8, 0.06]], env(0.06, 0.08, len - 0.06, 0.4), 4); break;
      case 'pizz': {
        const e = env(0.004, 0.45, 0, 0.35), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(3500, t); lp.frequency.exponentialRampToValueAtTime(250, t + 0.3);
        const o = osc('triangle', f); o.connect(lp); lp.connect(e.g); o.start(t); o.stop(e.stop);
        break;
      }
      case 'bassoon': {
        const e = env(0.02, 0.12, len * 0.55, 0.08), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 3;
        const o = osc('sawtooth', f); o.connect(lp); lp.connect(e.g); o.start(t); o.stop(e.stop);
        break;
      }
      case 'strings': case 'pad': {
        const pad = type === 'pad';
        const e = env(pad ? 0.6 : 0.25, pad ? 0.05 : 0.06, len - (pad ? 0.6 : 0.25), pad ? 1.4 : 0.6), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = pad ? 750 : 1300;
        for (const d of [-9, 9]) { const o = osc('sawtooth', f, d); o.connect(lp); o.start(t); o.stop(e.stop); }
        lp.connect(e.g);
        break;
      }
      case 'choir': {
        // "aah": detuned saws through two vowel formants
        const e = env(0.5, 0.07, len - 0.5, 1.2);
        for (const [fq, q] of [[700, 6], [1150, 8]]) {
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q; bp.connect(e.g);
          for (const d of [-12, 0, 12]) { const o = osc('sawtooth', f, d); o.connect(bp); o.start(t); o.stop(e.stop); }
        }
        break;
      }
      case 'theremin': {
        // gliding sine with a wide, wobbly vibrato
        const e = env(0.12, 0.17, len - 0.1, 0.25);
        const o = osc('sine', f);
        if (part.lastF) { o.frequency.setValueAtTime(part.lastF, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.14); }
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 5.8; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.014, t + 0.35);
        lfo.connect(lg); lg.connect(o.frequency);
        o.connect(e.g); o.start(t); o.stop(e.stop); lfo.start(t); lfo.stop(e.stop);
        part.lastF = f;
        break;
      }
    }
  }
  setMusic(v) { this.musicLevel = v; if (this.ctx) this.musicGain.gain.setTargetAtTime(this.musicMuted || this.musicPaused ? 0 : v * SETTINGS.music, this.ctx.currentTime, this.musicPaused ? 0.08 : 0.5); }
  panned(vol, pan) {
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(this.sfx); }
    else g.connect(this.sfx);
    return g;
  }
  jingle(vol, pan) {
    if (!this.ok || vol < 0.01) return;
    const c = this.ctx, out = this.panned(vol, pan);
    for (let k = 0; k < 3; k++) {
      const t = c.currentTime + Math.random() * 0.07;
      for (const fr of [2637, 3520, 4699, 6271]) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = fr * (1 + (Math.random() - 0.5) * 0.03);
        this.env(g, t, 0.08, 0.002, 0.22);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3);
      }
      const n = this.noise(), bp = c.createBiquadFilter(), ng = c.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 7500; bp.Q.value = 3;
      this.env(ng, t, 0.25, 0.001, 0.06);
      n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.1);
    }
  }
  heartbeat(vol) {
    if (!this.ok) return;
    const c = this.ctx;
    for (const [d, a] of [[0, 1], [0.17, 0.65]]) {
      const t = c.currentTime + d, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
      this.env(g, t, 0.9 * vol * a, 0.01, 0.2);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.3);
    }
  }
  giggle(vol, pan) {
    if (!this.ok) return;
    const c = this.ctx, out = this.panned(vol, pan);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2; f.connect(out);
    for (let i = 0; i < 6; i++) {
      const t = c.currentTime + i * 0.11, o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(780 - i * 30, t); o.frequency.linearRampToValueAtTime(980 - i * 40, t + 0.04); o.frequency.linearRampToValueAtTime(700 - i * 30, t + 0.09);
      this.env(g, t, 0.35, 0.01, 0.08);
      o.connect(g); g.connect(f); o.start(t); o.stop(t + 0.12);
    }
  }
  creak(vol = 0.5) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth';
    const curve = new Float32Array(24).map(() => 70 + Math.random() * 90);
    o.frequency.setValueCurveAtTime(curve, t, 0.45);
    f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 4;
    this.env(g, t, vol, 0.03, 0.45);
    o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.55);
  }
  // a ghostly "wooOOOooo" with vibrato
  wail(vol, pan, flee = false) {
    if (!this.ok || vol < 0.02) return;
    const c = this.ctx, t = c.currentTime, out = this.panned(vol, pan), dur = flee ? 1.0 : 2.2;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; f.connect(out);
    const g = c.createGain(); g.connect(f);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5.5; vg.gain.value = flee ? 40 : 14; vib.connect(vg);
    for (const det of [0, 7]) {
      const o = c.createOscillator(); o.type = 'sine';
      const f0 = flee ? 700 : 260, f1 = flee ? 1400 : 420;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.4); o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + dur);
      o.detune.value = det; vg.connect(o.frequency);
      o.connect(g); o.start(t); o.stop(t + dur);
    }
    vib.start(t); vib.stop(t + dur);
  }
  rattle(vol, pan) {
    if (!this.ok || vol < 0.02) return;
    const c = this.ctx, out = this.panned(vol, pan);
    for (let i = 0; i < 4; i++) {
      const t = c.currentTime + i * rrand(0.03, 0.07);
      const n = this.noise(), bp = c.createBiquadFilter(), g = c.createGain();
      bp.type = 'bandpass'; bp.frequency.value = rrand(1500, 3200); bp.Q.value = 9;
      this.env(g, t, 0.9, 0.001, 0.03);
      n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.06);
    }
  }
  squeal(pan) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, out = this.panned(0.9, pan);
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(2600, t + 0.15); o.frequency.exponentialRampToValueAtTime(500, t + 0.7);
    f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 2;
    this.env(g, t, 0.5, 0.01, 0.7);
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.8);
    const n = this.noise(), lp = c.createBiquadFilter(), ng = c.createGain();   // squish
    lp.type = 'lowpass'; lp.frequency.value = 700;
    this.env(ng, t, 0.9, 0.005, 0.25);
    n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.3);
  }
  whoosh() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.12); f.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    this.env(g, t, 0.35, 0.05, 0.2);
    n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 0.3);
  }
  bonk(vol, pan) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, out = this.panned(vol, pan);
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    this.env(g, t, 0.9, 0.002, 0.15);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
    const n = this.noise(), f = c.createBiquadFilter(), ng = c.createGain();
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 3;
    this.env(ng, t, 1.2, 0.001, 0.06);
    n.connect(f); f.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.1);
  }
  rustle(vol) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = rrand(2200, 4200); f.Q.value = 0.8;
    this.env(g, t, vol, 0.03, rrand(0.15, 0.3));
    n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 0.4);
  }
  hiss(vol, pan) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, out = this.panned(vol, pan);
    const n = this.noise(), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = 3200;
    this.env(g, t, 0.6, 0.05, 0.7);
    n.connect(hp); hp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.8);
  }
  gust(vol) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(900, t + 1.6); f.frequency.exponentialRampToValueAtTime(300, t + 4);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 4.3);
  }
  rumbleEarth(vol, pan) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, out = this.panned(vol, pan);
    const n = this.noise(), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 220;
    this.env(g, t, 1.0, 0.3, 1.4);
    n.connect(lp); lp.connect(g); g.connect(out); n.start(t); n.stop(t + 1.8);
  }
  hurt() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.25);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5;
    this.env(g, t, 0.5, 0.01, 0.3);
    o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.35);
    const b = c.createOscillator(), bg = c.createGain();
    b.frequency.setValueAtTime(110, t); b.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    this.env(bg, t, 0.8, 0.005, 0.3);
    b.connect(bg); bg.connect(this.sfx); b.start(t); b.stop(t + 0.35);
  }
  pickup() {
    if (!this.ok) return;
    const c = this.ctx;
    [72, 75, 79, 84, 87].forEach((m, i) => {
      const t = c.currentTime + i * 0.07, o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      this.env(g, t, 0.3, 0.005, 0.5);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.6);
    });
  }
  powerup() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
    this.env(g, t, 0.12, 0.01, 0.35);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.4);
  }
  click() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 2500;
    this.env(g, t, 0.4, 0.001, 0.03);
    n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 0.05);
  }
  scream() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const shaper = c.createWaveShaper();
    shaper.curve = new Float32Array(1024).map((_, i) => Math.tanh(((i / 512) - 1) * 6));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
    g.gain.setValueAtTime(0.9, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    shaper.connect(g); g.connect(this.sfx);
    for (const [type, det] of [['sawtooth', 0], ['square', 13], ['sawtooth', -23]]) {
      const o = c.createOscillator(); o.type = type; o.detune.value = det;
      o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.2);
      o.frequency.linearRampToValueAtTime(1100, t + 1.0); o.frequency.exponentialRampToValueAtTime(400, t + 1.8);
      const og = c.createGain(); og.gain.value = 0.25; o.connect(og); og.connect(shaper); o.start(t); o.stop(t + 1.9);
    }
    const n = this.noise(), hp = c.createBiquadFilter(), ng = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = 1800; ng.gain.value = 0.35;
    n.connect(hp); hp.connect(ng); ng.connect(g); n.start(t); n.stop(t + 1.9);
    const boom = c.createOscillator(), bg = c.createGain();
    boom.frequency.setValueAtTime(90, t); boom.frequency.exponentialRampToValueAtTime(30, t + 0.8);
    this.env(bg, t, 1.0, 0.01, 0.9);
    boom.connect(bg); bg.connect(this.sfx); boom.start(t); boom.stop(t + 1);
  }
  banish() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(4000, t + 2.2);
    this.env(g, t, 0.6, 0.6, 2.2);
    n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + 3);
    [60, 64, 67, 72, 76].forEach((m, i) => {
      const o = c.createOscillator(), og = c.createGain(), tt = t + 2.2 + i * 0.05;
      o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      this.env(og, tt, 0.18, 0.05, 2.5);
      o.connect(og); og.connect(this.sfx); o.start(tt); o.stop(tt + 2.7);
    });
  }
}
const audio = new AudioEngine();

// ============================================================================
// Settings (remembered in this browser)
// ============================================================================
const SETTING_ROWS = [
  { key: 'master', label: 'Master volume' },
  { key: 'music', label: 'Music' },
  { key: 'sfx', label: 'Sound effects' },
  { key: 'ambience', label: 'Ambience (wind)' },
];
const SETTINGS = { master: 1, music: 0.8, sfx: 1, ambience: 0.8, musicBoxWind: false };
try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem('elfSettings') || '{}')); } catch (_) {}
function saveSettings() { try { localStorage.setItem('elfSettings', JSON.stringify(SETTINGS)); } catch (_) {} }
function applySettings() {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  audio.master.gain.setTargetAtTime(0.9 * SETTINGS.master, now, 0.05);
  // in the music box it's just the music: wind, drone and effects fade out
  // (unless you've switched the wind back on in there)
  const box = state === 'jukebox';
  audio.sfx.gain.setTargetAtTime(SETTINGS.sfx * (box ? 0 : 1), now, 0.2);
  audio.amb.gain.setTargetAtTime(SETTINGS.ambience * (box && !SETTINGS.musicBoxWind ? 0 : 1), now, 0.2);
  audio.setMusic(audio.musicLevel);
}
let previewT = 0;
function setSetting(key, v) {
  SETTINGS[key] = clamp(Math.round(v * 20) / 20, 0, 1);
  saveSettings();
  if (!audio.ok) audio.init();
  applySettings();
  renderSettings();
  // let you hear the effects level as you change it
  if ((key === 'sfx' || key === 'master') && performance.now() - previewT > 180) { previewT = performance.now(); audio.click(); audio.jingle(0.5, 0); }
}
const menu = { sel: 0, ret: 'title', v: 0, h: 0, t: 0 };
function renderSettings() {
  document.querySelectorAll('#settings .setting').forEach((row, i) => {
    row.classList.toggle('selected', i === menu.sel);
    const k = row.dataset.key;
    if (!k) return;
    row.querySelector('input').value = Math.round(SETTINGS[k] * 100);
    row.querySelector('.val').textContent = Math.round(SETTINGS[k] * 100) + '%';
  });
}
function openSettings() {
  menu.ret = state; menu.sel = 0;
  setState('settings');
  renderSettings();
}
function closeSettings() { setState(menu.ret); }
// Menu navigation: key taps act at once; a held stick / D-pad / key acts, then auto-repeats.
function menuNav(m, dt, inp, act, hRepeat = 0.07) {
  // follow the stronger direction only, so a diagonal stick doesn't do two things at once
  const vert = Math.abs(inp.my) >= Math.abs(inp.mx);
  const v = vert && Math.abs(inp.my) > 0.5 ? Math.sign(inp.my) : 0, h = !vert && Math.abs(inp.mx) > 0.5 ? Math.sign(inp.mx) : 0;
  m.t -= dt;
  if (inp.navV || inp.navH) {
    act(inp.navV, inp.navH);
    m.t = 0.35; m.v = inp.navV || v; m.h = inp.navH || h;
  } else {
    const changed = v !== m.v || h !== m.h;
    if ((v || h) && (changed || m.t <= 0)) {
      act(v, h);
      m.t = changed ? 0.35 : (h ? hRepeat : 0.18);
    }
    m.v = v; m.h = h;
  }
}

function updateSettingsMenu(dt, inp) {
  if (inp.back || inp.pause) { closeSettings(); return; }
  const rows = SETTING_ROWS.length + 1;   // + Back
  menuNav(menu, dt, inp, (dv, dh) => {
    if (dv) { menu.sel = (menu.sel - dv + rows) % rows; renderSettings(); audio.click(); }
    else if (dh && menu.sel < SETTING_ROWS.length) { const k = SETTING_ROWS[menu.sel].key; setSetting(k, SETTINGS[k] + dh * 0.05); }
  });
  if (inp.action && menu.sel === SETTING_ROWS.length) closeSettings();
}

// ============================================================================
// Music box: browse and play the soundtrack from the title screen
// ============================================================================
const jb = { sel: 0, t: 0, v: 0, h: 0 };
function renderJukebox() {
  const list = $('jbList');
  if (!list) return;
  const cur = audio.currentTrack;
  [...list.children].forEach((li, i) => {
    li.classList.toggle('selected', i === jb.sel && state === 'jukebox');
    li.classList.toggle('playing', i === cur);
    li.querySelector('.state').textContent = i === cur ? (audio.musicPaused ? '❚❚' : '♪') : '';
  });
  $('jbPlay').textContent = audio.musicPaused ? '▶' : '❚❚';
  $('jbNow').textContent = cur >= 0 ? TRACKS[cur].name : '—';
  $('jbVol').value = Math.round(SETTINGS.music * 100);
  const w = $('jbWind');
  w.textContent = '🌬 Wind: ' + (SETTINGS.musicBoxWind ? 'On' : 'Off');
  w.setAttribute('aria-pressed', SETTINGS.musicBoxWind);
}
function toggleMusicBoxWind() {
  SETTINGS.musicBoxWind = !SETTINGS.musicBoxWind;
  saveSettings();
  applySettings();
  renderJukebox();
}
function openJukebox() {
  if (!audio.ok) audio.init();
  setState('jukebox');
  jb.sel = Math.max(0, audio.currentTrack);
  renderJukebox();
}
function closeJukebox() { setState('title'); }
function updateJukebox(dt, inp) {
  if (inp.back || inp.pause) { closeJukebox(); return; }
  menuNav(jb, dt, inp, (dv, dh) => {
    if (dv) { jb.sel = (jb.sel - dv + TRACKS.length) % TRACKS.length; renderJukebox(); audio.click(); }
    else if (dh > 0) audio.nextTrack();
    else if (dh < 0) audio.prevTrack();
  }, 0.4);
  if (inp.settings) toggleMusicBoxWind();
  if (inp.action) {
    if (jb.sel === audio.currentTrack) audio.togglePause();
    else audio.playTrack(jb.sel);
  }
  $('jbBar').style.width = (audio.progress * 100).toFixed(1) + '%';
}
{
  const list = $('jbList');
  TRACKS.forEach((tr, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="state"></span><span class="name">${tr.name}</span><span class="desc">${tr.desc}</span>`;
    li.addEventListener('click', () => { jb.sel = i; if (i === audio.currentTrack) audio.togglePause(); else audio.playTrack(i); });
    li.addEventListener('mouseenter', () => { jb.sel = i; renderJukebox(); });
    list.appendChild(li);
  });
  $('jbPrev').addEventListener('click', () => audio.prevTrack());
  $('jbNext').addEventListener('click', () => audio.nextTrack());
  $('jbPlay').addEventListener('click', () => audio.togglePause());
  $('jbClose').addEventListener('click', closeJukebox);
  $('jbWind').addEventListener('click', toggleMusicBoxWind);
  $('jbVol').addEventListener('input', (e) => setSetting('music', e.target.value / 100));
  $('openJukebox').addEventListener('click', (e) => { e.stopPropagation(); openJukebox(); });
  $('playBtn').addEventListener('click', () => { if (state === 'title') { startGame(); lockPointer(); } });
}
{
  // build the slider rows and wire up the mouse
  const list = $('settingsList');
  SETTING_ROWS.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'setting'; row.dataset.key = r.key;
    row.innerHTML = `<label>${r.label}</label><input type="range" min="0" max="100" step="5"><span class="val"></span>`;
    row.querySelector('input').addEventListener('input', (e) => setSetting(r.key, e.target.value / 100));
    row.addEventListener('mouseenter', () => { menu.sel = i; renderSettings(); });
    list.appendChild(row);
  });
  const back = document.createElement('div');
  back.className = 'setting back';
  back.innerHTML = '<button type="button">Back</button>';
  back.querySelector('button').addEventListener('click', closeSettings);
  back.addEventListener('mouseenter', () => { menu.sel = SETTING_ROWS.length; renderSettings(); });
  list.appendChild(back);
  for (const id of ['openSettingsTitle', 'openSettingsPause']) $(id).addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
  // the pause menu shows the same controls list as the title screen
  $('pauseControls').replaceWith(document.querySelector('#title .controls').cloneNode(true), document.querySelector('#title .touch-help').cloneNode(true));
  $('resumeBtn').addEventListener('click', () => { if (state === 'paused') setState('playing'); });
  renderSettings();
}

// ============================================================================
// Particles: instanced camera-facing quads, two pools (glowing + smoky).
// Fog puffs fade where they meet the ground so there are no hard edges.
// ============================================================================
const puffTex = canvasTex(128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    const x = w / 2 + rrand(-22, 22), y = h / 2 + rrand(-16, 16), r = rrand(22, 44);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  // fade the square's edges so no corners show
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w / 2);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, w, h);
});
const particleFog = { value: 0.04 };
const PARTICLE_VS = `
  attribute vec3 iPos; attribute vec4 iColor; attribute float iSize; attribute float iRot; attribute float iGround;
  uniform float uFog;
  varying vec2 vUv; varying vec4 vColor; varying float vGroundFade;
  void main() {
    vUv = uv;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float c = cos(iRot), s = sin(iRot);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize;
    vec3 world = iPos + right * p.x + up * p.y;
    vGroundFade = iGround < -900.0 ? 1.0 : smoothstep(iGround, iGround + iSize * 0.35, world.y);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    float d = -mv.z;
    vColor = vec4(iColor.rgb, iColor.a * exp(-pow(d * uFog, 2.0)) * smoothstep(0.25, 1.0 + iSize * 0.5, d));
    gl_Position = projectionMatrix * mv;
  }`;
const PARTICLE_FS = `
  uniform sampler2D map;
  varying vec2 vUv; varying vec4 vColor; varying float vGroundFade;
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = t.a * vColor.a * vGroundFade;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor.rgb * t.rgb, a);
  }`;

class ParticlePool {
  constructor(max, tex, additive, renderOrder) {
    this.max = max; this.list = [];
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const attr = (name, n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
      a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a;
    };
    this.aPos = attr('iPos', 3); this.aCol = attr('iColor', 4); this.aSize = attr('iSize', 1);
    this.aRot = attr('iRot', 1); this.aGround = attr('iGround', 1);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uFog: particleFog },
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = renderOrder;
    scene.add(mesh);
  }
  emit(o) {
    if (this.list.length >= this.max) return null;
    const p = {
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.age || 0, max: o.life || 1,
      r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1, a: o.a ?? 1, s0: o.size ?? 0.1, s1: o.size1 ?? o.size ?? 0.1,
      grav: o.grav || 0, drag: o.drag || 0, wind: o.wind || 0, rot: o.rot ?? Math.random() * 6.28, vr: o.vr || 0,
      flick: o.flick || false, pulse: o.pulse || 0, fadeIn: o.fadeIn || 0.05, ground: o.ground ?? -1000, tag: o.tag || 0,
    };
    this.list.push(p);
    return p;
  }
  update(dt, t, wx, wz) {
    const L = this.list;
    let i = 0;
    while (i < L.length) {
      const p = L[i];
      p.life += dt;
      if (p.life >= p.max) { L[i] = L[L.length - 1]; L.pop(); continue; }
      p.vy += p.grav * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += (p.vx + wx * p.wind) * dt; p.y += p.vy * dt; p.z += (p.vz + wz * p.wind) * dt;
      p.rot += p.vr * dt;
      const k = p.life / p.max;
      let a = p.a * Math.min(1, p.life / p.fadeIn) * Math.min(1, (1 - k) / 0.35);
      if (p.flick) a *= 0.55 + 0.45 * Math.sin(t * 14 + p.rot * 20);
      if (p.pulse) a *= 0.6 + 0.4 * Math.sin(t * p.pulse + p.rot * 10);
      this.aPos.array[i * 3] = p.x; this.aPos.array[i * 3 + 1] = p.y; this.aPos.array[i * 3 + 2] = p.z;
      this.aCol.array[i * 4] = p.r; this.aCol.array[i * 4 + 1] = p.g; this.aCol.array[i * 4 + 2] = p.b; this.aCol.array[i * 4 + 3] = a;
      this.aSize.array[i] = p.s0 + (p.s1 - p.s0) * k;
      this.aRot.array[i] = p.rot;
      this.aGround.array[i] = p.ground;
      i++;
    }
    this.geo.instanceCount = L.length;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aRot.needsUpdate = this.aGround.needsUpdate = true;
  }
}
const glowFx = new ParticlePool(5000, glowTex, true, 6);
const smokeFx = new ParticlePool(1400, puffTex, false, 3);

const fxAcc = {};
function every(key, rate, dt, fn) {
  fxAcc[key] = Math.min(20, (fxAcc[key] || 0) + rate * dt);
  while (fxAcc[key] >= 1) { fxAcc[key] -= 1; fn(); }
}
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const randDir = () => { const v = new THREE.Vector3(rrand(-1, 1), rrand(-1, 1), rrand(-1, 1)); return v.lengthSq() > 1e-4 ? v.normalize() : v.set(0, 1, 0); };

function sparkBurst(pos, n, colors, { speed = 2.5, size = 0.08, life = 1.2, grav = -2, up = 0.4 } = {}) {
  for (let i = 0; i < n; i++) {
    const d = randDir(), sp = speed * rrand(0.3, 1), c = pick(colors);
    glowFx.emit({
      x: pos.x, y: pos.y, z: pos.z, vx: d.x * sp, vy: d.y * sp + speed * up, vz: d.z * sp,
      life: rrand(life * 0.5, life), r: c[0], g: c[1], b: c[2], a: 1, size: size * rrand(0.6, 1.3), size1: size * 0.15,
      grav, drag: 1.2, flick: true,
    });
  }
}
function dirtBurst(x, y, z) {
  for (let i = 0; i < 45; i++) {
    const a = Math.random() * Math.PI * 2, sp = rrand(0.5, 2);
    smokeFx.emit({
      x: x + rrand(-0.3, 0.3), y: y + 0.1, z: z + rrand(-0.3, 0.3), vx: Math.cos(a) * sp, vy: rrand(2, 4.5), vz: Math.sin(a) * sp,
      life: rrand(0.9, 1.5), r: 0.2, g: 0.14, b: 0.08, a: 1, size: rrand(0.1, 0.22), size1: 0.08, grav: -9, vr: rrand(-4, 4),
    });
  }
  for (let i = 0; i < 10; i++) {
    smokeFx.emit({
      x: x + rrand(-0.6, 0.6), y: y + 0.3, z: z + rrand(-0.6, 0.6), vx: rrand(-0.4, 0.4), vy: rrand(0.2, 0.6), vz: rrand(-0.4, 0.4),
      life: rrand(2, 3), r: 0.3, g: 0.25, b: 0.2, a: 0.35, size: 0.8, size1: 2.4, drag: 0.8, wind: 0.4, vr: rrand(-0.5, 0.5),
    });
  }
}
const COLORS = {
  candy: [[1, 0.55, 0.1], [1, 0.85, 0.2], [1, 1, 0.9]],
  battery: [[0.55, 1, 0.3], [0.85, 1, 0.5]],
  elf: [[1, 0.12, 0.1], [0.2, 1, 0.35], [1, 0.85, 0.3]],
  ghost: [[0.6, 0.75, 1], [0.85, 0.9, 1]],
  banish: [[0.25, 1, 0.45], [0.6, 1, 0.6], [1, 1, 0.8]],
};

// Dust motes that only glitter inside the flashlight beam (they wrap around the camera)
const beamDust = (() => {
  const n = 1800, seed = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) seed[i] = Math.random();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
  const uniforms = {
    uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSpotPos: { value: new THREE.Vector3() },
    uSpotDir: { value: new THREE.Vector3(0, 0, -1) }, uCos: { value: 0.9 }, uOn: { value: 0 }, uScale: { value: 500 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 seed;
      uniform vec3 uCam; uniform float uTime; uniform vec3 uSpotPos; uniform vec3 uSpotDir; uniform float uCos; uniform float uOn; uniform float uScale;
      varying float vA;
      void main() {
        float R = 9.0;
        vec3 p = seed * 2.0 * R + vec3(sin(uTime * 0.3 + seed.y * 20.0) * 0.6, -uTime * 0.06 + sin(uTime * 0.2 + seed.x * 10.0) * 0.4, cos(uTime * 0.25 + seed.z * 20.0) * 0.6);
        p = mod(p - uCam + R, 2.0 * R) - R + uCam;
        vec3 d = p - uSpotPos; float dist = length(d);
        float c = dot(d / max(dist, 0.001), uSpotDir);
        vA = uOn * smoothstep(uCos, uCos + 0.05, c) * smoothstep(13.0, 1.5, dist) * (0.55 + 0.45 * sin(uTime * 3.0 + seed.x * 50.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = max(1.0, (0.012 + seed.y * 0.02) * uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5 || vA < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * vA * (1.0 - r * 2.0), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 7;
  scene.add(pts);
  return uniforms;
})();

// Moths fluttering around every warm light
const moths = (() => {
  const lights = [];
  const n = 90, pos = new Float32Array(n * 3), seeds = [];
  for (let i = 0; i < n; i++) seeds.push({ li: i, ph: Math.random() * 100, r: rrand(0.3, 1.0), w: rrand(2, 4) });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, color: 0xfff0c8, size: 0.09, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  return { g, pos, seeds, lights };
})();

function updateParticles(dt, t) {
  const gust = wind.uWind.value, wx = 0.8 * gust, wz = 0.5 * gust;
  const centre = state === 'title' ? camera.position : G.pos;

  // fog breathes slowly, and thickens in the forests
  let inForest = 0;
  for (const [fx, fz, fr] of FORESTS) inForest = Math.max(inForest, 1 - smoothstep(fr * 0.6, fr + 6, Math.hypot(centre.x - fx, centre.z - fz)));
  scene.fog.density = 0.05 + 0.009 * Math.sin(t * 0.05) + inForest * 0.025;
  particleFog.value = scene.fog.density;

  // rolling fog banks
  let fogCount = 0;
  for (const p of smokeFx.list) {
    if (p.tag !== 1) continue;
    fogCount++;
    if (Math.hypot(p.x - centre.x, p.z - centre.z) > 36 && p.life < p.max - 3) p.life = p.max - 3;
  }
  const fogTarget = (LOW_POWER ? 50 : 120) + Math.round(inForest * (LOW_POWER ? 30 : 60));
  for (let k = 0; k < 3 && fogCount < fogTarget; k++, fogCount++) {
    const a = Math.random() * Math.PI * 2, r = rrand(3, 32);
    const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r;
    if (inHouseFootprint(x, z, 2)) continue;
    const gy = heightAt(x, z), size = rrand(7, 14);
    smokeFx.emit({
      x, y: gy + size * 0.22, z, vx: rrand(-0.15, 0.15), vz: rrand(-0.15, 0.15), life: rrand(16, 26),
      r: 0.46, g: 0.43, b: 0.6, a: rrand(0.12, 0.2) * (1 + inForest * 0.5), size, size1: size * 1.2,
      wind: 0.35, fadeIn: 4, ground: gy, tag: 1, vr: rrand(-0.03, 0.03),
    });
  }

  // cauldron: embers and glowing steam
  every('ember', 28, dt, () => glowFx.emit({
    x: rrand(-0.6, 0.6), y: 0.35, z: rrand(-0.6, 0.6), vx: rrand(-0.3, 0.3), vy: rrand(1.2, 2.8), vz: rrand(-0.3, 0.3),
    life: rrand(1.2, 2.6), r: 1, g: rrand(0.45, 0.8), b: 0.15, a: 1, size: rrand(0.05, 0.11), size1: 0.02, grav: 0.3, drag: 0.6, wind: 0.5, flick: true,
  }));
  every('steam', 7, dt, () => glowFx.emit({
    x: rrand(-0.5, 0.5), y: 1.85, z: rrand(-0.5, 0.5), vy: rrand(0.4, 0.8), life: rrand(2, 3.5),
    r: 0.3, g: 1, b: 0.45, a: 0.16, size: 0.6, size1: 2.6, wind: 0.6, drag: 0.3, vr: rrand(-0.5, 0.5),
  }));
  // sparks from the lit jack-o'-lanterns, smoke from the candles
  for (const p of pumpkins) {
    if (!p.light || p.light.position.distanceTo(centre) > 40) continue;
    const lp = p.light.position;
    every('pk' + p.phase, 3, dt, () => glowFx.emit({
      x: lp.x + rrand(-0.15, 0.15), y: lp.y, z: lp.z + rrand(-0.15, 0.15), vx: rrand(-0.2, 0.2), vy: rrand(0.4, 1.0), vz: rrand(-0.2, 0.2),
      life: rrand(0.8, 1.6), r: 1, g: 0.6, b: 0.2, a: 0.9, size: 0.05, size1: 0.01, grav: 0.2, wind: 0.4, flick: true,
    }));
  }
  for (const h of houses) {
    const cp = h.candleLight.position;
    if (cp.distanceTo(centre) > 30) continue;
    every('cs' + h.def.cx, 2.5, dt, () => smokeFx.emit({
      x: cp.x + rrand(-0.2, 0.2), y: cp.y - 0.25, z: cp.z + rrand(-0.2, 0.2), vy: rrand(0.25, 0.45), life: rrand(2.5, 4),
      r: 0.55, g: 0.52, b: 0.55, a: 0.2, size: 0.08, size1: 0.7, vr: rrand(-1, 1), drag: 0.2,
    }));
  }
  // spirit orbs rising out of graves
  every('orb', 1.2, dt, () => {
    const gs = pick(graveSpots);
    if (!gs || Math.hypot(gs.x - centre.x, gs.z - centre.z) > 30) return;
    glowFx.emit({
      x: gs.x + rrand(-0.3, 0.3), y: heightAt(gs.x, gs.z) + 0.2, z: gs.z + rrand(-0.3, 0.3),
      vx: rrand(-0.15, 0.15), vy: rrand(0.15, 0.35), vz: rrand(-0.15, 0.15), life: rrand(7, 11),
      r: 0.55, g: 0.75, b: 1, a: 0.9, size: 0.3, size1: 0.12, pulse: rrand(2, 4), wind: 0.15, fadeIn: 1.5,
    });
  });
  // glowing spores drifting up from the forest floor
  if (inForest > 0.05) every('spore', 30 * inForest, dt, () => {
    const a = Math.random() * Math.PI * 2, r = rrand(1, 12);
    const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r;
    glowFx.emit({
      x, y: heightAt(x, z) + rrand(0.1, 1.5), z, vx: rrand(-0.1, 0.1), vy: rrand(0.05, 0.25), vz: rrand(-0.1, 0.1),
      life: rrand(4, 8), r: 0.35, g: 1, b: 0.8, a: 0.8, size: 0.05, size1: 0.03, pulse: rrand(1.5, 3), fadeIn: 1, wind: 0.3,
    });
  });
  // ash and dust floating everywhere
  every('ash', LOW_POWER ? 22 : 50, dt, () => {
    const a = Math.random() * Math.PI * 2, r = rrand(0.5, 15);
    const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r;
    glowFx.emit({
      x, y: centre.y + rrand(-0.3, 6), z, vx: rrand(-0.1, 0.1), vy: rrand(-0.12, 0.05), vz: rrand(-0.1, 0.1),
      life: rrand(5, 9), r: 0.75, g: 0.7, b: 0.85, a: 0.35, size: 0.035, size1: 0.03, wind: 0.9, fadeIn: 1.5,
    });
  });
  // monsters
  if (state === 'playing' && G.elfMoving) every('elfsp', 30, dt, () => {
    const c = pick(COLORS.elf);
    glowFx.emit({
      x: G.elfPos.x + rrand(-0.25, 0.25), y: G.elfPos.y + rrand(0.3, 1.8), z: G.elfPos.z + rrand(-0.25, 0.25),
      vx: rrand(-0.4, 0.4), vy: rrand(0, 0.8), vz: rrand(-0.4, 0.4), life: rrand(0.8, 1.5),
      r: c[0], g: c[1], b: c[2], a: 1, size: 0.07, size1: 0.01, grav: -1.0, flick: true,
    });
  });
  if (state === 'banishing' && elf.root.visible) every('ban', 80, dt, () => {
    const c = pick(COLORS.banish), p = elf.root.position;
    glowFx.emit({ x: p.x + rrand(-0.4, 0.4), y: p.y + rrand(0, 1.6), z: p.z + rrand(-0.4, 0.4), vx: rrand(-1, 1), vy: rrand(-0.5, 1), vz: rrand(-1, 1),
      life: rrand(0.6, 1.2), r: c[0], g: c[1], b: c[2], a: 1, size: 0.1, size1: 0.02, flick: true });
  });
  ghosts.forEach((g, gi) => {
    if (!g.root.visible || g.alpha < 0.15) return;
    every('gh' + gi, 14, dt, () => glowFx.emit({
      x: g.root.position.x + rrand(-0.35, 0.35), y: g.root.position.y + rrand(-0.5, 0.2), z: g.root.position.z + rrand(-0.35, 0.35),
      vx: -g.vel.x * 0.2 + rrand(-0.1, 0.1), vy: rrand(-0.05, 0.15), vz: -g.vel.z * 0.2 + rrand(-0.1, 0.1),
      life: rrand(0.8, 1.6), r: 0.6, g: 0.75, b: 1, a: 0.45 * g.alpha, size: 0.3, size1: 0.04, drag: 1,
    }));
  });

  glowFx.update(dt, t, wx, wz);
  smokeFx.update(dt, t, wx, wz);

  // flashlight dust
  beamDust.uCam.value.copy(camera.position);
  beamDust.uTime.value = t;
  beamDust.uSpotPos.value.copy(flashlight.position);
  beamDust.uSpotDir.value.copy(flashlight.target.position).sub(flashlight.position).normalize();
  beamDust.uCos.value = Math.cos(flashlight.angle);
  beamDust.uOn.value = flashlight.intensity > 0 ? 1 : 0;
  beamDust.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

  // moths
  if (!moths.lights.length) {
    for (const p of pumpkins) if (p.light) moths.lights.push(p.light.position);
    for (const h of houses) moths.lights.push(h.candleLight.position);
    moths.lights.push(new THREE.Vector3(0, 2.4, 0));
  }
  moths.seeds.forEach((m, i) => {
    const c = moths.lights[m.li % moths.lights.length];
    const a = t * m.w + m.ph;
    moths.pos[i * 3] = c.x + Math.sin(a) * m.r + Math.sin(t * 17 + m.ph) * 0.06;
    moths.pos[i * 3 + 1] = c.y + 0.3 + Math.sin(a * 1.3 + m.ph) * 0.35 + Math.sin(t * 23 + m.ph) * 0.05;
    moths.pos[i * 3 + 2] = c.z + Math.cos(a * 0.9) * m.r + Math.cos(t * 19 + m.ph) * 0.06;
  });
  moths.g.attributes.position.needsUpdate = true;
}

// ============================================================================
// Input: gamepad + keyboard/mouse
// ============================================================================
const keys = {};
const keyEdges = new Set();
let mouseDX = 0, mouseDY = 0, mouseClicked = false, mouseSwing = false;
addEventListener('keydown', (e) => {
  if (!keys[e.code]) keyEdges.add(e.code);
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!audio.ok) audio.init();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement) { mouseDX += e.movementX; mouseDY += e.movementY; }
});
const lockPointer = () => { if (touch.on) return; try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch (_) {} };

// ============================================================================
// Touch controls (phones and tablets): a floating joystick on the left,
// drag on the right to look, and buttons under the right thumb.
// ============================================================================
const touch = {
  on: false, mx: 0, my: 0, lookDX: 0, lookDY: 0,
  sprint: false, flash: false, swing: false, use: false, pause: false,
  stickId: null, lookId: null, lookX: 0, lookY: 0, baseX: 0, baseY: 0,
};
const STICK_R = 60;
function restStick() {
  touch.baseX = 100 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sal')) || 0);
  touch.baseY = innerHeight - 110;
  const b = $('stickBase');
  b.style.left = touch.baseX + 'px'; b.style.top = touch.baseY + 'px';
  b.classList.remove('active');
  $('stickKnob').style.transform = 'translate(0px, 0px)';
}
function enableTouch() {
  if (touch.on) return;
  touch.on = true;
  document.body.classList.add('touch');
  // talk about taps instead of keys and buttons
  document.querySelector('#title .start').innerHTML = 'Tap anywhere to begin… if you dare';
  document.querySelector('#paused .start').innerHTML = 'Tap <b>Resume</b> to carry on';
  document.querySelector('#gameover .start').innerHTML = 'Tap to try again';
  document.querySelector('#win .start').innerHTML = 'Tap to play again';
  restStick();
  $('touch').classList.toggle('hidden', state !== 'playing');
}
{
  if (LOW_POWER) queueMicrotask(enableTouch);   // after the rest of the game has loaded
  addEventListener('touchstart', () => { enableTouch(); if (!audio.ok) audio.init(); }, { passive: true });
  addEventListener('touchend', () => { if (!audio.ok) audio.init(); }, { passive: true });   // iOS unlocks audio on touchend
  addEventListener('resize', () => { if (touch.on && touch.stickId === null) restStick(); });

  const layer = $('touch');
  layer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tbtn')) return;
    e.preventDefault();
    if (e.clientX < innerWidth * 0.45 && touch.stickId === null) {
      touch.stickId = e.pointerId;
      touch.baseX = e.clientX; touch.baseY = e.clientY;
      const b = $('stickBase');
      b.style.left = e.clientX + 'px'; b.style.top = e.clientY + 'px';
      b.classList.add('active');
    } else if (touch.lookId === null) {
      touch.lookId = e.pointerId; touch.lookX = e.clientX; touch.lookY = e.clientY;
    }
  });
  layer.addEventListener('pointermove', (e) => {
    if (e.pointerId === touch.stickId) {
      let dx = e.clientX - touch.baseX, dy = e.clientY - touch.baseY;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      $('stickKnob').style.transform = `translate(${dx}px, ${dy}px)`;
      touch.mx = dx / STICK_R; touch.my = -dy / STICK_R;
    } else if (e.pointerId === touch.lookId) {
      touch.lookDX += e.clientX - touch.lookX; touch.lookDY += e.clientY - touch.lookY;
      touch.lookX = e.clientX; touch.lookY = e.clientY;
    }
  });
  const release = (e) => {
    if (e.pointerId === touch.stickId) { touch.stickId = null; touch.mx = touch.my = 0; restStick(); }
    if (e.pointerId === touch.lookId) touch.lookId = null;
  };
  layer.addEventListener('pointerup', release);
  layer.addEventListener('pointercancel', release);

  const button = (id, down, up) => {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); down(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { b.classList.remove('down'); if (up) up(); });
  };
  button('tFlash', () => { touch.flash = true; });
  button('tSwing', () => { touch.swing = true; });
  button('tSprint', () => { touch.sprint = true; }, () => { touch.sprint = false; });
  button('tUse', () => { touch.use = true; });
  button('tPause', () => { touch.pause = true; });
}
addEventListener('mousedown', (e) => {
  if (!audio.ok) audio.init();
  if (e.target.closest && e.target.closest('button, input, #settings, #jukebox')) return;
  if (state === 'title' || ((state === 'gameover' || state === 'won') && stateTime > 0.8)) { startGame(); lockPointer(); }
  else if (state === 'playing') {
    if (!document.pointerLockElement) lockPointer();
    else if (e.button === 0) mouseSwing = true;
    else if (e.button === 2) mouseClicked = true;
  }
});
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing' && !activePad) setState('paused');
});

let activePad = null;
let prevPad = [];
addEventListener('gamepadconnected', (e) => { updatePadStatus(e.gamepad); });
addEventListener('gamepaddisconnected', () => { activePad = null; updatePadStatus(null); });
function updatePadStatus(gp) {
  const el = $('padstatus');
  if (gp) {
    el.textContent = '🎮 ' + gp.id.replace(/\(.*?\)/g, '').trim().slice(0, 40) + ' connected';
    el.style.color = '#6dff8f';
  } else {
    el.textContent = '🎮 No controller found. Press any button on it to connect';
    el.style.color = '';
  }
}
const deadzone = (v, dz = 0.15) => (Math.abs(v) < dz ? 0 : Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz)));

function readInput() {
  const inp = { mx: 0, my: 0, lx: 0, ly: 0, sprint: false, flash: false, swing: false, action: false, pause: false, nextTrack: false, music: false, back: false, settings: false };
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (gp && !activePad) updatePadStatus(gp);
  activePad = gp;
  if (gp) {
    const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
    const edge = (i) => b(i) && !prevPad[i];
    const ax = deadzone(gp.axes[0] || 0), ay = deadzone(gp.axes[1] || 0);
    const rx = deadzone(gp.axes[2] || 0), ry = deadzone(gp.axes[3] || 0);
    inp.mx += ax; inp.my -= ay;
    inp.lx += Math.sign(rx) * rx * rx; inp.ly += Math.sign(ry) * ry * ry;
    if (b(12)) inp.my += 1;
    if (b(13)) inp.my -= 1;
    if (b(14)) inp.mx -= 1;
    if (b(15)) inp.mx += 1;
    inp.sprint = b(6) || b(1) || b(10);
    inp.flash = edge(7) || edge(5);
    inp.swing = edge(2);
    inp.nextTrack = edge(3);
    inp.action = edge(0);
    inp.pause = edge(9) || edge(8);
    inp.back = edge(1);
    inp.settings = edge(2);
    inp.jukebox = edge(4);
    if (!audio.ok && gp.buttons.some((x) => x.pressed)) audio.init();
    prevPad = gp.buttons.map((x) => x.pressed || x.value > 0.5);
  }
  if (keys.KeyW || keys.ArrowUp) inp.my += 1;
  if (keys.KeyS || keys.ArrowDown) inp.my -= 1;
  if (keys.KeyD || keys.ArrowRight) inp.mx += 1;
  if (keys.KeyA || keys.ArrowLeft) inp.mx -= 1;
  if (keys.ShiftLeft || keys.ShiftRight) inp.sprint = true;
  if (keyEdges.has('KeyF') || mouseClicked) inp.flash = true;
  if (keyEdges.has('KeyQ') || mouseSwing) inp.swing = true;
  if (keyEdges.has('KeyN')) inp.nextTrack = true;
  if (keyEdges.has('KeyM')) inp.music = true;
  if (keyEdges.has('Enter') || keyEdges.has('Space') || keyEdges.has('KeyE')) inp.action = true;
  if (keyEdges.has('KeyP') || keyEdges.has('Escape')) inp.pause = true;
  if (keyEdges.has('Backspace')) inp.back = true;
  // discrete key taps for menus (a quick tap can start and end between two frames)
  inp.navV = (keyEdges.has('ArrowUp') || keyEdges.has('KeyW') ? 1 : 0) - (keyEdges.has('ArrowDown') || keyEdges.has('KeyS') ? 1 : 0);
  inp.navH = (keyEdges.has('ArrowRight') || keyEdges.has('KeyD') ? 1 : 0) - (keyEdges.has('ArrowLeft') || keyEdges.has('KeyA') ? 1 : 0);
  if (keyEdges.has('KeyO')) inp.settings = true;
  if (keyEdges.has('KeyJ')) inp.jukebox = true;
  const len = Math.hypot(inp.mx, inp.my);
  if (len > 1) { inp.mx /= len; inp.my /= len; }
  if (touch.on) {
    inp.mx = clamp(inp.mx + touch.mx, -1, 1); inp.my = clamp(inp.my + touch.my, -1, 1);
    if (touch.sprint) inp.sprint = true;
    if (touch.flash) inp.flash = true;
    if (touch.swing) inp.swing = true;
    if (touch.use) inp.action = true;
    if (touch.pause) inp.pause = true;
    mouseDX += touch.lookDX * 2.2; mouseDY += touch.lookDY * 2.2;   // drag to look
    touch.lookDX = touch.lookDY = 0;
    touch.flash = touch.swing = touch.use = touch.pause = false;
  }
  inp.mouseDX = mouseDX; inp.mouseDY = mouseDY;
  mouseDX = mouseDY = 0; mouseClicked = mouseSwing = false; keyEdges.clear();
  return inp;
}

function rumble(strong, weak, ms) {
  const a = activePad && activePad.vibrationActuator;
  if (a && a.playEffect) a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
}

// ============================================================================
// Game state
// ============================================================================
let state = 'title';
let stateTime = 0;
const G = {};
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const trail = [];   // breadcrumbs of where the player has been, for the elf to follow

function resetGame() {
  scatterPickups();
  trail.length = 0;
  Object.assign(G, {
    pos: new THREE.Vector3(0, 0, 2.5), vy: 0, facing: 0, yaw: 0, pitch: 0.22,
    stamina: 100, battery: 1, flashOn: true, flicker: 0, flickerCooldown: 3,
    courage: 100, invuln: 0, lastHurt: -99, hurtFlash: 0, knock: new THREE.Vector3(),
    candies: 0, time: 0, walkPhase: 0, moving: 0,
    elf: { pos: new THREE.Vector3(-14, heightAt(-14, -12), -12), vy: 0 },
    elfYaw: 0, elfMoving: false, elfWalk: 0, elfTarget: null, elfRepath: 0,
    elfSeen: false, elfUnseenFar: 0, elfJingleT: 0, elfGiggleT: 8, elfSnapT: 4,
    elfTilt: 0, elfReach: 0, elfStuckT: 0, glare: 0, elfMode: 'lurk', elfLostT: 0,
    swingT: 1, swingCd: 0,
    heartT: 0, prox: 0, shake: 0, banishT: 0, caughtBy: null,
  });
  G.elfPos = G.elf.pos;
  relocateElf(28);
  clearBoneDebris();
  cauldron.beam.visible = false;
  elf.root.visible = true;
  elf.root.scale.setScalar(1);
  elf.headMat.emissiveIntensity = 4;
  ghosts.forEach((g) => { g.state = 'gone'; g.timer = rrand(4, 14); g.root.visible = false; g.alpha = 0; });
  skeletons.forEach((s) => {
    s.state = 'buried'; s.root.visible = false; s.timer = 0; s.rattleT = 0; s.walk = 0; s.vy = 0;
    s.hp = 3; s.stagger = 0; s.knock = new THREE.Vector3(); s.deadT = 0;
    s.pos.set(s.home.x, heightAt(s.home.x, s.home.z) - 1.9, s.home.z);
  });
  spiders.forEach((s) => {
    s.state = 'hanging'; s.pos.copy(s.house.spiderHang); s.timer = 0; s.walk = 0; s.target = null; s.hissT = 0;
    reviveSpider(s);
    s.root.visible = true; s.thread.visible = true;
  });
}

function setState(s) {
  state = s; stateTime = 0;
  for (const id of ['title', 'paused', 'gameover', 'win', 'settings', 'jukebox']) $(id).classList.add('hidden');
  const playingUI = s === 'playing' || s === 'paused' || s === 'banishing';
  $('hud').classList.toggle('hidden', !playingUI);
  $('objective').classList.toggle('hidden', !playingUI);
  if (s === 'title') $('title').classList.remove('hidden');
  if (s === 'paused') $('paused').classList.remove('hidden');
  if (s === 'settings') $('settings').classList.remove('hidden');
  if (s === 'jukebox') $('jukebox').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !(touch.on && s === 'playing'));
  if (s !== 'playing') { touch.sprint = false; touch.mx = touch.my = 0; touch.stickId = touch.lookId = null; if (touch.on) restStick(); }
  if (s === 'gameover') $('gameover').classList.remove('hidden');
  if (s === 'won') $('win').classList.remove('hidden');
  if (s !== 'playing') $('prompt').classList.add('hidden');
  if (s !== 'playing' && s !== 'banishing') { toastTimer = 0; $('toast').style.opacity = 0; }
  if (s !== 'playing' && s !== 'paused' && document.pointerLockElement) document.exitPointerLock();
  applySettings();
  if (s === 'jukebox') audio.setMusic(0.7);
  else if (s !== 'settings') audio.setMusic(s === 'playing' ? 0.55 : s === 'title' ? 0.35 : 0.15);
  if (s !== 'jukebox' && s !== 'settings' && audio.musicPaused) audio.togglePause();   // never leave the game silent
}

let nowPlayingTimer = null;
function showNowPlaying(name) {
  const el = $('nowplaying');
  if (!el) return;
  el.textContent = '♪ ' + name;
  el.style.opacity = 1;
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => { el.style.opacity = 0; }, 5000);
}

let toastTimer = 0;
function toast(text, secs = 2.5, color) {
  const el = $('toast');
  el.textContent = text;
  el.style.color = color || '';
  el.style.opacity = 1;
  toastTimer = secs;
}
function setObjective() {
  const housesLeft = candies.slice(0, houses.length).filter((c) => !c.taken).length;
  $('objective').textContent = G.candies < CFG.candyCount
    ? `Find the cursed candy corn. Follow the orange lights${housesLeft ? ` (${housesLeft} hidden upstairs in the houses)` : ''}.`
    : 'Bring the candy to the green cauldron to banish the Elf!';
}

function goFullscreen() {
  // full screen + landscape where the browser allows it (Android). Safari on iPhone doesn't,
  // and some browsers throw or don't return a promise, so never let this get in the way.
  try {
    const el = document.documentElement;
    if (!touch.on || document.fullscreenElement || !el.requestFullscreen) return;
    const r = el.requestFullscreen();
    if (r && r.then) r.then(() => { try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch (_) {} }).catch(() => {});
  } catch (_) {}
}

function startGame() {
  try { audio.init(); } catch (_) {}
  resetGame();
  setState('playing');
  setObjective();
  toast('He only moves when no one is watching…', 4, '#ff3b2f');
  goFullscreen();
}

// ============================================================================
// Visibility
// ============================================================================
const _os = new THREE.Vector3(), _os2 = new THREE.Vector3();
function onScreen(p, margin = 0.92) {
  _os.copy(p).sub(camera.position);
  camera.getWorldDirection(_os2);
  if (_os.dot(_os2) <= 0) return false;
  _os.copy(p).project(camera);
  return Math.abs(_os.x) < margin && Math.abs(_os.y) < margin;
}

function terrainBlocks(a, b) {
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    if (heightAt(lerp(a.x, b.x, t), lerp(a.z, b.z, t)) > lerp(a.y, b.y, t) + 0.05) return true;
  }
  return false;
}

const _los = new THREE.Vector3();
function lineOfSight(p, from = camera.position) {
  _los.copy(p).sub(from);
  const d = _los.length();
  raycaster.set(from, _los.normalize());
  raycaster.far = d - 0.3;
  if (raycaster.intersectObjects(occluders, false).length) return false;
  if (terrainBlocks(from, p)) return false;
  // dense bushes hide what's behind them (but not the bush you're standing in)
  for (let i = 1; i < 16; i++) {
    const t = i / 16, x = lerp(from.x, p.x, t), y = lerp(from.y, p.y, t), z = lerp(from.z, p.z, t);
    const b = bushAt(x, z, y, 0.8);
    if (b && Math.hypot(G.pos.x - b.x, G.pos.z - b.z) > b.r && Math.hypot(p.x - b.x, p.z - b.z) > b.r * 0.5) return false;
  }
  return true;
}

const _fl = new THREE.Vector3(), _fl2 = new THREE.Vector3();
function inFlashBeam(p, range = CFG.flashRange) {
  if (!flashlightEmitting()) return false;
  _fl.copy(p).sub(flashlight.position);
  const d = _fl.length();
  if (d > range) return false;
  _fl2.copy(flashlight.target.position).sub(flashlight.position).normalize();
  return _fl.normalize().dot(_fl2) > Math.cos(flashlight.angle * 1.05);
}

function isLit(p, distToCam) {
  if (distToCam < CFG.naturalSight) return true;
  if (inFlashBeam(p)) return true;
  for (const z of lightZones) if (z.pos.distanceTo(p) < z.r) return true;
  return false;
}

const elfPoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function canSeeElf() {
  const e = G.elfPos;
  elfPoints[0].set(e.x, e.y + 1.65, e.z);
  elfPoints[1].set(e.x, e.y + 1.0, e.z);
  elfPoints[2].set(e.x, e.y + 0.4, e.z);
  for (const p of elfPoints) {
    const d = p.distanceTo(camera.position);
    if (d > CFG.maxSight || !onScreen(p) || !isLit(p, d) || !lineOfSight(p)) continue;
    return true;
  }
  return false;
}

function flashlightEmitting() {
  return G.flashOn && G.battery > 0 && G.flicker <= 0;
}

function panTo(p) {
  const rx = Math.cos(G.yaw), rz = -Math.sin(G.yaw);
  tmpV2.copy(p).sub(camera.position).setY(0).normalize();
  return tmpV2.x * rx + tmpV2.z * rz;
}
const volAt = (p, range) => Math.pow(clamp(1 - p.distanceTo(G.pos) / range, 0, 1), 1.3);

// ============================================================================
// Update: player
// ============================================================================
function updatePlayer(dt, inp) {
  G.yaw -= inp.lx * CFG.lookSpeed * dt + inp.mouseDX * 0.0024;
  G.pitch = clamp(G.pitch + inp.ly * CFG.lookSpeed * 0.65 * dt + inp.mouseDY * 0.002, -0.35, 1.05);

  const fx = -Math.sin(G.yaw), fz = -Math.cos(G.yaw);
  const rx = Math.cos(G.yaw), rz = -Math.sin(G.yaw);
  const mvx = fx * inp.my + rx * inp.mx, mvz = fz * inp.my + rz * inp.mx;
  const mag = Math.hypot(mvx, mvz);
  const sprinting = inp.sprint && mag > 0.2 && G.stamina > 0;
  G.stamina = clamp(G.stamina + (sprinting ? -CFG.staminaDrain : CFG.staminaRegen * (mag > 0.1 ? 0.6 : 1)) * dt, 0, 100);
  const inBush = bushAt(G.pos.x, G.pos.z, G.pos.y + 0.5, 0.9);
  const speed = (sprinting ? CFG.sprintSpeed : CFG.walkSpeed) * mag * (inBush ? 0.65 : 1);
  G.rustleT = (G.rustleT || 0) - dt;
  if (inBush && mag > 0.2 && G.rustleT <= 0) { G.rustleT = rrand(0.25, 0.4); audio.rustle(0.5); }
  if (mag > 0.01) {
    G.pos.x += (mvx / mag) * speed * dt;
    G.pos.z += (mvz / mag) * speed * dt;
    let diff = Math.atan2(mvx, mvz) - G.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    G.facing += diff * Math.min(1, dt * 12);
  } else {
    let diff = Math.atan2(fx, fz) - G.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    G.facing += diff * Math.min(1, dt * 4);
  }
  // knockback from monsters
  G.pos.addScaledVector(G.knock, dt);
  G.knock.multiplyScalar(Math.exp(-6 * dt));
  collide(G.pos, PLAYER_R, PLAYER_H);
  {
    const ex = G.pos.x - G.elfPos.x, ez = G.pos.z - G.elfPos.z, d = Math.hypot(ex, ez), min = PLAYER_R + 0.3;
    if (d < min && d > 1e-4 && Math.abs(G.pos.y - G.elfPos.y) < 1.2) { G.pos.x = G.elfPos.x + (ex / d) * min; G.pos.z = G.elfPos.z + (ez / d) * min; }
  }
  settle(G, dt);
  G.moving = lerp(G.moving, mag > 0.05 ? (sprinting ? 1.4 : 1) : 0, dt * 10);
  G.walkPhase += dt * speed * 2.6;

  const last = trail[trail.length - 1];
  if (!last || Math.hypot(last.x - G.pos.x, last.z - G.pos.z) > 0.7 || Math.abs(last.y - G.pos.y) > 0.4) {
    trail.push(G.pos.clone());
    if (trail.length > 300) trail.shift();
  }

  player.root.position.copy(G.pos);
  player.root.rotation.y = G.facing;
  const sw = Math.sin(G.walkPhase) * 0.7 * G.moving;
  player.legs[0].rotation.x = sw; player.legs[1].rotation.x = -sw;
  player.arms[0].rotation.x = -sw * 0.6;
  G.swingCd -= dt;
  if (inp.swing && G.swingCd <= 0) {
    G.swingCd = 0.5; G.swingT = 0;
    G.facing = Math.atan2(fx, fz);
    audio.whoosh();
    swingHit(fx, fz);
  }
  G.swingT = Math.min(1, G.swingT + dt / 0.32);
  if (G.swingT < 1) {
    const k = 1 - Math.pow(1 - G.swingT, 3);
    player.arms[1].rotation.set(lerp(-2.9, -0.5, k), 0, lerp(-0.9, 0.7, k));
  } else player.arms[1].rotation.set(-1.2 + G.pitch * 0.4, 0, 0);
  player.body.position.y = Math.abs(Math.cos(G.walkPhase)) * 0.06 * G.moving;

  if (inp.flash) {
    if (G.battery > 0) { G.flashOn = !G.flashOn; audio.click(); }
    else { audio.click(); toast('Battery dead!', 1.5, '#ffe39a'); }
  }
  const inSafe = Math.hypot(G.pos.x, G.pos.z) < CFG.safeRadius;
  if (G.flashOn) G.battery = Math.max(0, G.battery - CFG.batteryDrain * dt);
  if (inSafe) G.battery = Math.min(1, G.battery + 0.07 * dt);
  if (G.battery <= 0 && G.flashOn) { G.flashOn = false; toast('Your flashlight died…', 2, '#ff3b2f'); }
  G.flicker -= dt;
  G.flickerCooldown -= dt;
  const elfDist = G.elfPos.distanceTo(G.pos);
  if (G.flashOn && G.flickerCooldown <= 0 && G.glare <= 0 && (elfDist < 14 || G.battery < 0.15) && G.time > CFG.elfGraceTime) {
    G.flicker = rrand(0.12, 0.35);
    G.flickerCooldown = rrand(1.6, 4.5) * (G.battery < 0.15 ? 0.6 : 1);
  }

  // courage slowly returns when you're left alone, quickly by the cauldron
  G.invuln -= dt;
  if (inSafe) G.courage = Math.min(100, G.courage + 15 * dt);
  else if (G.time - G.lastHurt > 5) G.courage = Math.min(100, G.courage + 2.5 * dt);
  G.hurtFlash = Math.max(0, G.hurtFlash - dt * 2.5);
}

function hurt(amount, source, from) {
  if (G.invuln > 0 || state !== 'playing') return;
  if (Math.hypot(G.pos.x, G.pos.z) < CFG.safeRadius) return;
  G.courage -= amount;
  G.invuln = 1.2;
  G.lastHurt = G.time;
  G.hurtFlash = 1;
  G.shake = 0.07;
  audio.hurt();
  rumble(0.7, 0.9, 300);
  if (from) {
    G.knock.copy(G.pos).sub(from).setY(0);
    if (G.knock.lengthSq() < 1e-4) G.knock.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    G.knock.normalize().multiplyScalar(7);
  }
  if (G.courage <= 0) { G.courage = 0; caught(source); }
}

function updateCamera(dt) {
  const head = new THREE.Vector3(G.pos.x, G.pos.y + 1.55, G.pos.z);
  const right = new THREE.Vector3(Math.cos(G.yaw), 0, -Math.sin(G.yaw));
  const dist = 4.0;
  const dir = new THREE.Vector3(Math.sin(G.yaw) * Math.cos(G.pitch), Math.sin(G.pitch), Math.cos(G.yaw) * Math.cos(G.pitch));
  // over-the-shoulder offset, pulled in if a wall is right beside you
  raycaster.set(head, right); raycaster.far = 0.8;
  const sideHit = raycaster.intersectObjects(occluders, false)[0];
  const shoulder = sideHit ? Math.max(0, sideHit.distance - 0.25) : 0.55;
  const pivot = head.clone().addScaledVector(right, Math.min(0.55, shoulder));
  raycaster.set(pivot, dir); raycaster.far = dist;
  const hit = raycaster.intersectObjects(occluders, false)[0];
  const d = hit ? Math.max(0.5, hit.distance - 0.3) : dist;
  camera.position.copy(pivot).addScaledVector(dir, d);
  camera.position.y = Math.max(heightAt(camera.position.x, camera.position.z) + 0.35, camera.position.y);
  if (G.shake > 0) {
    camera.position.x += rrand(-1, 1) * G.shake; camera.position.y += rrand(-1, 1) * G.shake;
    G.shake = Math.max(0, G.shake - dt * 0.8);
  }
  camera.lookAt(pivot.clone().addScaledVector(dir, -6));

  player.lens.getWorldPosition(flashlight.position);
  camera.getWorldDirection(tmpV2);
  flashlight.target.position.copy(camera.position).addScaledVector(tmpV2, 18);
  flashlight.target.updateMatrixWorld();
  const flick = G.battery < 0.25 ? 0.5 + G.battery * 2 : 1;
  flashlight.intensity = flashlightEmitting() ? 140 * flick : 0;
}

// ============================================================================
// Update: the Elf. Follows your trail when he can't reach you directly.
// ============================================================================
const _tp = new THREE.Vector3();
function teleportElf() {
  for (let i = trail.length - 1; i >= 0; i--) {
    const c = trail[i];
    const d = Math.hypot(c.x - G.pos.x, c.z - G.pos.z);
    if (d < 11 || d > 22 || Math.hypot(c.x, c.z) < CFG.safeRadius + 1) continue;
    _tp.set(c.x, c.y + 1, c.z);
    if (onScreen(_tp, 1.1) && lineOfSight(_tp)) continue;
    G.elfPos.copy(c); G.elf.vy = 0; G.elfStuckT = 0; G.elfTarget = null;
    return;
  }
  camera.getWorldDirection(tmpV2);
  for (let t = 0; t < 20; t++) {
    const back = Math.atan2(-tmpV2.x, -tmpV2.z) + rrand(-1.1, 1.1);
    const r = rrand(13, 19);
    const x = G.pos.x + Math.sin(back) * r, z = G.pos.z + Math.cos(back) * r;
    const y = heightAt(x, z);
    if (blockedAt(x, z, y, 0.6) || Math.hypot(x, z) < CFG.safeRadius + 1 || inHouseFootprint(x, z, 1)) continue;
    if (onScreen(_tp.set(x, y + 1, z), 1.1)) continue;
    G.elfPos.set(x, y, z); G.elf.vy = 0; G.elfStuckT = 0; G.elfTarget = null;
    return;
  }
}

// Send the elf off to lurk somewhere random and far away: a thicket, a forest, a house, the open.
function relocateElf(minDist = 30) {
  for (let k = 0; k < 120; k++) {
    const roll = Math.random();
    let x, y, z;
    if (roll < 0.35 && bushes.length) { const b = pick(bushes); x = b.x; z = b.z; y = b.y; }
    else if (roll < 0.6) {
      const [fx, fz, fr] = pick(FORESTS), a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * fr;
      x = fx + Math.cos(a) * r; z = fz + Math.sin(a) * r; y = heightAt(x, z);
    } else if (roll < 0.72) {
      const h = pick(houses), reg = h.region, ho = h.hole;
      x = rrand(reg.minX, reg.maxX); z = rrand(reg.minZ, reg.maxZ); y = h.f2;
      if (x > ho.minX && x < ho.maxX && z > ho.minZ && z < ho.maxZ) continue;
    } else {
      const a = Math.random() * Math.PI * 2, r = rrand(8, CFG.worldRadius - 3);
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = heightAt(x, z);
      if (inHouseFootprint(x, z, 1)) continue;
    }
    if (blockedAt(x, z, y, 0.4)) continue;
    if (Math.hypot(x - G.pos.x, z - G.pos.z) < minDist || Math.hypot(x, z) < CFG.safeRadius + 4) continue;
    if (onScreen(_tp.set(x, y + 1, z), 1.1) && lineOfSight(_tp)) continue;
    G.elfPos.set(x, y, z);
    G.elf.vy = 0; G.elfStuckT = 0; G.elfTarget = null; G.elfLostT = 0;
    return;
  }
  // fallback: the far side of the map from you
  const a = Math.atan2(-G.pos.z, -G.pos.x) + rrand(-0.5, 0.5), x = Math.cos(a) * 42, z = Math.sin(a) * 42;
  G.elfPos.set(x, heightAt(x, z), z);
}

function wakeElf(finale) {
  G.elfMode = 'hunt';
  G.elfLostT = 0; G.elfGiggleT = rrand(5, 9);
  audio.giggle(0.9, panTo(G.elfPos));
  setTimeout(() => audio.jingle(0.6, panTo(G.elfPos)), 500);
  rumble(0.3, 0.5, 200);
  toast(finale ? 'He knows what you\'ve done… RUN!' : 'You wandered into his hiding place…', 2.6, '#ff3b2f');
}

function updateElf(dt) {
  G.elfSeen = canSeeElf();
  const dist = Math.hypot(G.pos.x - G.elfPos.x, G.pos.z - G.elfPos.z);
  const dy = Math.abs(G.pos.y - G.elfPos.y);
  const active = G.time > CFG.elfGraceTime;
  const playerSafe = Math.hypot(G.pos.x, G.pos.z) < CFG.safeRadius;

  G.elfMoving = false;
  const finale = G.candies >= CFG.candyCount;
  const lurkR = CFG.elfLurkRadius + G.candies * 1.2;
  if (active && G.elfMode === 'lurk') {
    if (finale || (dist < lurkR && dy < 3)) wakeElf(finale);
    else {
      // waiting... he turns to watch you, but only while you aren't looking
      if (!G.elfSeen) {
        const want = Math.atan2(G.pos.x - G.elfPos.x, G.pos.z - G.elfPos.z);
        G.elfYaw += Math.atan2(Math.sin(want - G.elfYaw), Math.cos(want - G.elfYaw)) * Math.min(1, dt * 2);
      }
      G.elfReach = lerp(G.elfReach, 0, dt * 4);
      G.elfGiggleT -= dt;
      if (dist < lurkR + 10 && G.elfGiggleT <= 0) { G.elfGiggleT = rrand(8, 14); audio.giggle(0.25, panTo(G.elfPos)); }
    }
  }
  const hunting = active && G.elfMode === 'hunt';
  if (hunting && !G.elfSeen) {
    let speed = CFG.elfBaseSpeed + G.candies * CFG.elfSpeedPerCandy;
    if (dist > 22) speed *= 1.8;

    // pick where to go: straight at you, or the newest bit of your trail he can reach
    G.elfRepath -= dt;
    if (G.elfRepath <= 0) {
      G.elfRepath = 0.25;
      if (clearPath(G.elfPos, G.pos)) G.elfTarget = G.pos;
      else {
        G.elfTarget = null;
        for (let i = trail.length - 1; i >= 0; i--) if (clearPath(G.elfPos, trail[i])) { G.elfTarget = trail[i]; break; }
      }
    }
    const tgt = G.elfTarget;
    const before = G.elfPos.clone();
    if (tgt) {
      const tx = tgt.x - G.elfPos.x, tz = tgt.z - G.elfPos.z, td = Math.hypot(tx, tz);
      if (tgt !== G.pos && td < 0.4) G.elfRepath = 0;
      const base = Math.atan2(tx, tz);
      for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.2, -2.2]) {
        const a = base + off;
        if (probeBlocked(G.elfPos, a, 0.4, 0.3)) continue;
        const step = Math.min(speed * dt, Math.max(0, (tgt === G.pos ? dist - 0.5 : td)));
        G.elfPos.x += Math.sin(a) * step; G.elfPos.z += Math.cos(a) * step;
        G.elfYaw = a;
        G.elfMoving = true;
        break;
      }
    }
    if (G.elfMoving) G.elfWalk += dt * speed * 3.2;
    collide(G.elfPos, 0.35, 1.9);
    const r = Math.hypot(G.elfPos.x, G.elfPos.z);
    if (r < CFG.safeRadius) { G.elfPos.x *= CFG.safeRadius / r; G.elfPos.z *= CFG.safeRadius / r; }
    settle(G.elf, dt);

    const actual = Math.hypot(G.elfPos.x - before.x, G.elfPos.z - before.z);
    G.elfStuckT = actual < speed * dt * 0.25 && dist > 3 ? G.elfStuckT + dt : 0;
    if (G.elfStuckT > 2.5) teleportElf();
    if (finale) {
      // once you have all the candy he never stops coming
      G.elfUnseenFar = dist > 26 ? G.elfUnseenFar + dt : 0;
      if (G.elfUnseenFar > 2.5) { teleportElf(); G.elfUnseenFar = 0; }
    } else {
      // outrun him and he loses your scent, settling down to lurk wherever he is
      G.elfLostT = dist > 32 ? G.elfLostT + dt : 0;
      if (G.elfLostT > 6) { G.elfMode = 'lurk'; G.elfLostT = 0; }
    }

    G.elfReach = lerp(G.elfReach, dist < 6 ? 1 : 0, dt * 6);
    G.elfTilt = lerp(G.elfTilt, 0, dt * 4);

    G.elfJingleT -= dt;
    if (G.elfJingleT <= 0) {
      G.elfJingleT = 0.27;
      audio.jingle(Math.pow(clamp(1 - dist / 32, 0, 1), 1.4) * 0.9, panTo(G.elfPos));
    }
    G.elfGiggleT -= dt;
    if (G.elfGiggleT <= 0 && dist < 22) {
      G.elfGiggleT = rrand(7, 14);
      audio.giggle(clamp(1 - dist / 24, 0.1, 1) * 0.8, panTo(G.elfPos));
    }
  } else if (G.elfSeen && active) {
    G.elfSnapT -= dt;
    if (G.elfSnapT <= 0 && dist < 16) {
      G.elfSnapT = rrand(3, 7);
      G.elfTilt = (Math.random() < 0.5 ? -1 : 1) * rrand(0.35, 0.6);
      audio.creak(0.4 * clamp(1 - dist / 18, 0.2, 1));
    }
  }

  if (hunting && !G.elfSeen && !playerSafe && dist < CFG.catchDist && dy < 1.2) { caught('elf'); return; }

  // Stare him down: keep the flashlight on him up close and he'll scurry away
  const glaring = active && G.elfSeen && dist < 7 && inFlashBeam(elfPoints[1]);
  G.glare = glaring ? G.glare + dt : Math.max(0, G.glare - dt * 0.6);
  if (G.glare >= 1.5) {
    G.glare = 0;
    audio.giggle(0.8, panTo(G.elfPos));
    audio.hiss(0.6, panTo(G.elfPos));
    rumble(0.4, 0.6, 250);
    G.battery = Math.max(0, G.battery - 0.06);
    sparkBurst(tmpV.set(G.elfPos.x, G.elfPos.y + 1.1, G.elfPos.z), 80, COLORS.elf, { speed: 4 });
    for (let i = 0; i < 8; i++) smokeFx.emit({ x: G.elfPos.x + rrand(-0.4, 0.4), y: G.elfPos.y + rrand(0.3, 1.5), z: G.elfPos.z + rrand(-0.4, 0.4),
      vx: rrand(-0.5, 0.5), vy: rrand(0.2, 0.8), vz: rrand(-0.5, 0.5), life: rrand(1.5, 2.5), r: 0.08, g: 0.06, b: 0.1, a: 0.6, size: 0.8, size1: 2, drag: 1, vr: rrand(-1, 1) });
    relocateElf(30);
    if (!finale) G.elfMode = 'lurk';
    G.elfUnseenFar = 0;
    toast('He scurried off into the dark…', 2.2, '#ffe39a');
  }

  elf.root.position.copy(G.elfPos);
  elf.root.rotation.y = G.elfYaw;
  const sw = Math.sin(G.elfWalk) * 0.8;
  elf.legs[0].rotation.x = sw; elf.legs[1].rotation.x = -sw;
  elf.arms[0].rotation.x = lerp(-sw * 0.7, -1.45, G.elfReach);
  elf.arms[1].rotation.x = lerp(sw * 0.7, -1.35, G.elfReach);
  elf.body.position.y = Math.abs(Math.cos(G.elfWalk)) * 0.08;
  elf.body.rotation.z = Math.sin(G.elfWalk * 0.5) * 0.06;
  elf.headPivot.rotation.z = G.elfTilt;
  if (G.glare > 0) {   // he trembles under the light
    const j = G.glare * 0.04;
    elf.root.position.x += rrand(-j, j); elf.root.position.z += rrand(-j, j);
    elf.headPivot.rotation.z += rrand(-1, 1) * G.glare * 0.15;
  }
  const eyeOp = clamp(1.3 - dist / 26, 0, 1);
  for (const e of elf.eyes) e.material.opacity = eyeOp;

  G.prox = active ? clamp(1 - dist / 15, 0, 1) : 0;
  G.heartT -= dt;
  if (G.prox > 0.05 && G.heartT <= 0) {
    G.heartT = lerp(1.2, 0.38, G.prox);
    audio.heartbeat(0.35 + G.prox * 0.65);
    rumble(0.25 * G.prox, 0.5 * G.prox, 120);
  }
}

// ============================================================================
// Update: ghosts
// ============================================================================
const _g = new THREE.Vector3();
function updateGhosts(dt, t) {
  const chest = _g.set(G.pos.x, G.pos.y + 1.2, G.pos.z);
  for (const g of ghosts) {
    if (g.state === 'gone') {
      g.timer -= dt;
      if (g.timer <= 0 && G.time > 12) {
        for (let k = 0; k < 20; k++) {
          const a = Math.random() * Math.PI * 2, r = rrand(18, 30);
          const x = G.pos.x + Math.cos(a) * r, z = G.pos.z + Math.sin(a) * r;
          if (Math.hypot(x, z) > CFG.worldRadius - 2 || Math.hypot(x, z) < 10) continue;
          g.pos.set(x, heightAt(x, z) + 1.6, z);
          g.state = 'wander'; g.alpha = 0; g.root.visible = true; g.moanT = rrand(2, 6);
          g.wander = new THREE.Vector3(x + rrand(-10, 10), 0, z + rrand(-10, 10));
          break;
        }
      }
      continue;
    }
    const d = g.pos.distanceTo(chest);
    if (g.state !== 'flee' && d < 20 && inFlashBeam(g.pos, 20) && lineOfSight(g.pos)) {
      g.state = 'flee'; g.timer = 1.6;
      sparkBurst(g.pos, 40, COLORS.ghost, { speed: 3, size: 0.14, grav: 0, up: 0.1 });
      audio.wail(volAt(g.pos, 30) * 0.9, panTo(g.pos), true);
    }
    if (g.state === 'flee') {
      g.vel.copy(g.pos).sub(chest).setY(0.3).normalize().multiplyScalar(7);
      g.alpha = Math.max(0, g.alpha - dt * 0.9);
      g.timer -= dt;
      if (g.timer <= 0) { g.state = 'gone'; g.timer = rrand(10, 18); g.root.visible = false; }
    } else {
      if (d < 18) g.state = 'chase';
      else if (g.state === 'chase' && d > 26) g.state = 'wander';
      if (g.state === 'chase') {
        g.vel.copy(chest).sub(g.pos).normalize().multiplyScalar(2.5 + G.candies * 0.12);
      } else {
        if (Math.hypot(g.wander.x - g.pos.x, g.wander.z - g.pos.z) < 1.5) g.wander.set(g.pos.x + rrand(-12, 12), 0, g.pos.z + rrand(-12, 12));
        g.vel.set(g.wander.x - g.pos.x, 0, g.wander.z - g.pos.z).normalize().multiplyScalar(1.1);
        g.vel.y = (heightAt(g.pos.x, g.pos.z) + 1.6 - g.pos.y) * 1.5;
      }
      g.alpha = Math.min(1, g.alpha + dt * 0.6);
      g.moanT -= dt;
      if (g.moanT <= 0 && d < 22) { g.moanT = rrand(5, 10); audio.wail(volAt(g.pos, 24) * 0.6, panTo(g.pos)); }
      if (d < 0.95) {
        hurt(CFG.damage.ghost, 'ghost', g.pos);
        g.state = 'flee'; g.timer = 1.2;
        sparkBurst(g.pos, 30, COLORS.ghost, { speed: 2.5, size: 0.14, grav: 0, up: 0.1 });
      }
    }
    g.pos.addScaledVector(g.vel, dt);
    const r = Math.hypot(g.pos.x, g.pos.z);
    if (r < CFG.safeRadius + 0.5 && g.state !== 'flee') { g.pos.x *= (CFG.safeRadius + 0.5) / r; g.pos.z *= (CFG.safeRadius + 0.5) / r; }
    g.root.position.set(g.pos.x, g.pos.y - 0.5 + Math.sin(t * 2 + g.pos.x) * 0.15, g.pos.z);
    if (g.vel.lengthSq() > 0.01) g.root.rotation.y = Math.atan2(g.vel.x, g.vel.z);
    g.root.rotation.z = Math.sin(t * 1.7 + g.pos.z) * 0.12;
    g.mat.opacity = 0.6 * g.alpha;
    g.holeMat.opacity = g.alpha;
    g.glow.material.opacity = 0.35 * g.alpha;
  }
}

// ============================================================================
// Update: skeletons
// ============================================================================
// Swing the flashlight like a club. Skeletons take three hits; spiders get driven back.
function swingHit(fx, fz) {
  let hit = false;
  for (const s of skeletons) {
    if (s.state !== 'walk' && s.state !== 'rising') continue;
    const dx = s.pos.x - G.pos.x, dz = s.pos.z - G.pos.z, d = Math.hypot(dx, dz);
    if (d > 2.1 || Math.abs(s.pos.y - G.pos.y) > 1.3) continue;
    if (d > 0.5 && (dx * fx + dz * fz) / d < 0.3) continue;   // must be in front of you
    hitSkeleton(s, dx / (d || 1), dz / (d || 1));
    hit = true;
  }
  for (const sp of spiders) {
    if (sp.state !== 'hunt' && sp.state !== 'retreat') continue;
    const dx = sp.pos.x - G.pos.x, dz = sp.pos.z - G.pos.z, d = Math.hypot(dx, dz);
    if (d > 2.2 || Math.abs(sp.pos.y - G.pos.y) > 1.3 || (d > 0.5 && (dx * fx + dz * fz) / d < 0.3)) continue;
    hitSpider(sp, dx / (d || 1), dz / (d || 1));
    hit = true;
  }
  if (hit) { rumble(0.6, 0.4, 120); G.shake = Math.max(G.shake, 0.04); }
}

const ICHOR = [[0.35, 1, 0.3], [0.6, 1, 0.2], [0.2, 0.8, 0.25]];
function hitSpider(sp, nx, nz) {
  sp.hp--;
  sp.stagger = 0.5;
  sp.knock.set(nx * 8, 0, nz * 8);
  sp.state = 'retreat'; sp.timer = 1.4;
  audio.hiss(0.8, panTo(sp.pos)); audio.bonk(0.7, panTo(sp.pos));
  sparkBurst(tmpV.set(sp.pos.x, sp.pos.y + 0.6, sp.pos.z), 30, ICHOR, { speed: 2.5, size: 0.08, grav: -7 });
  if (sp.hp <= 0) killSpider(sp);
}
function killSpider(sp) {
  sp.state = 'dead'; sp.deadT = rrand(60, 90); sp.dieT = 0;
  audio.squeal(panTo(sp.pos));
  sparkBurst(tmpV.set(sp.pos.x, sp.pos.y + 0.6, sp.pos.z), 70, ICHOR, { speed: 3.5, size: 0.1, grav: -8, life: 1.5 });
  rumble(0.7, 0.5, 250);
  toast('Spider squashed!', 1.5, '#7dff6a');
}
function reviveSpider(sp) {
  sp.hp = 3; sp.stagger = 0; sp.deadT = 0; sp.dieT = 0;
  sp.knock = sp.knock || new THREE.Vector3(); sp.knock.set(0, 0, 0);
  sp.root.rotation.set(0, 0, 0);
  for (const L of sp.legs) L.knee.rotation.z = -L.s * 1.6;
}

function hitSkeleton(s, nx, nz) {
  s.hp--;
  s.stagger = 0.55;
  s.knock.set(nx * 7, 0, nz * 7);
  audio.bonk(1, panTo(s.pos));
  audio.rattle(0.8, panTo(s.pos));
  sparkBurst(tmpV.set(s.pos.x, s.pos.y + 1.3, s.pos.z), 25, [[1, 0.95, 0.8], [0.9, 0.85, 0.7]], { speed: 3, size: 0.06, grav: -6 });
  if (s.hp <= 0) smashSkeleton(s, nx, nz);
}

// Shatter into a spray of tumbling bones
const boneDebris = [];
const _dq = new THREE.Quaternion(), _dv = new THREE.Vector3();
function smashSkeleton(s, nx, nz) {
  s.state = 'dead'; s.deadT = rrand(50, 70);
  s.root.updateMatrixWorld(true);
  s.root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.clone();
    o.getWorldPosition(m.position); o.getWorldQuaternion(m.quaternion); o.getWorldScale(m.scale);
    scene.add(m);
    boneDebris.push({
      m, t: 0,
      v: new THREE.Vector3(nx * rrand(1, 4) + rrand(-1.5, 1.5), rrand(2, 5), nz * rrand(1, 4) + rrand(-1.5, 1.5)),
      w: new THREE.Vector3(rrand(-12, 12), rrand(-12, 12), rrand(-12, 12)),
    });
  });
  s.root.visible = false;
  dirtBurst(s.pos.x, s.pos.y, s.pos.z);
  audio.rattle(1, panTo(s.pos)); setTimeout(() => audio.rattle(0.8, 0), 120); setTimeout(() => audio.rattle(0.5, 0), 300);
  rumble(0.8, 0.6, 250);
  toast('Skeleton smashed!', 1.5, '#e8e0c8');
}
function updateBoneDebris(dt) {
  for (let i = boneDebris.length - 1; i >= 0; i--) {
    const b = boneDebris[i];
    b.t += dt;
    const ground = heightAt(b.m.position.x, b.m.position.z) + 0.04;
    if (b.t < 4) {
      b.v.y -= GRAVITY * dt;
      b.m.position.addScaledVector(b.v, dt);
      if (b.m.position.y < ground) {
        b.m.position.y = ground;
        b.v.y = Math.abs(b.v.y) * 0.3; b.v.x *= 0.6; b.v.z *= 0.6; b.w.multiplyScalar(0.5);
      }
      _dq.setFromEuler(new THREE.Euler(b.w.x * dt, b.w.y * dt, b.w.z * dt));
      b.m.quaternion.multiply(_dq);
    } else b.m.position.y -= dt * 0.15;   // slowly sink back into the earth
    if (b.t > 9) { scene.remove(b.m); boneDebris.splice(i, 1); }
  }
}
function clearBoneDebris() { for (const b of boneDebris) scene.remove(b.m); boneDebris.length = 0; }

function updateSkeletons(dt) {
  updateBoneDebris(dt);
  for (const s of skeletons) {
    const dist = Math.hypot(G.pos.x - s.pos.x, G.pos.z - s.pos.z);
    const ground = heightAt(s.home.x, s.home.z);
    if (s.state === 'dead') {
      s.deadT -= dt;
      if (s.deadT <= 0) { s.state = 'buried'; s.hp = 3; s.pos.set(s.home.x, ground - 1.9, s.home.z); }
      continue;
    }
    if (s.state === 'buried') {
      if (dist < 9 && G.time > 8 && !houseAt(G.pos)) {
        s.state = 'rising'; s.timer = 0; s.root.visible = true;
        dirtBurst(s.home.x, ground, s.home.z);
        s.pos.set(s.home.x, ground - 1.9, s.home.z);
        audio.rumbleEarth(volAt(s.pos, 20), panTo(s.pos));
        audio.rattle(volAt(s.pos, 20), panTo(s.pos));
      } else continue;
    }
    if (s.state === 'rising') {
      s.timer += dt;
      const k = Math.min(1, s.timer / 1.8);
      s.pos.y = ground - 1.9 * (1 - k * k * (3 - 2 * k));
      s.root.rotation.y = Math.atan2(G.pos.x - s.pos.x, G.pos.z - s.pos.z);
      s.arms[0].rotation.x = s.arms[1].rotation.x = -2.6 * (1 - k) - 1.3 * k;
      s.body.rotation.x = 0.4 * (1 - k);
      if (k >= 1) { s.state = 'walk'; s.lostT = 0; }
    } else if (s.state === 'walk' && s.stagger > 0) {
      // reeling from a hit
      s.stagger -= dt;
      s.pos.addScaledVector(s.knock, dt);
      s.knock.multiplyScalar(Math.exp(-7 * dt));
      collide(s.pos, 0.3, 1.8);
      settle(s, dt);
      s.body.rotation.x = -0.5 * (s.stagger / 0.55);
      s.arms[0].rotation.x = s.arms[1].rotation.x = -0.4;
    } else if (s.state === 'walk') {
      const lit = inFlashBeam(_g.set(s.pos.x, s.pos.y + 1.2, s.pos.z), 20);
      const speed = (lit ? 0.7 : 2.1) + G.candies * 0.1;
      const base = Math.atan2(G.pos.x - s.pos.x, G.pos.z - s.pos.z);
      let moved = false;
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
        const a = base + off;
        if (probeBlocked(s.pos, a, 0.45, 0.28)) continue;
        if (dist > 0.6) { s.pos.x += Math.sin(a) * speed * dt; s.pos.z += Math.cos(a) * speed * dt; }
        const da = Math.atan2(Math.sin(a - s.root.rotation.y), Math.cos(a - s.root.rotation.y));
        s.root.rotation.y += da * 0.2;
        moved = true;
        break;
      }
      collide(s.pos, 0.3, 1.8);
      const r = Math.hypot(s.pos.x, s.pos.z);
      if (r < CFG.safeRadius + 0.3) { s.pos.x *= (CFG.safeRadius + 0.3) / r; s.pos.z *= (CFG.safeRadius + 0.3) / r; }
      settle(s, dt);
      s.walk += dt * speed * 3.5 * (moved ? 1 : 0);
      const sw = Math.sin(s.walk) * 0.6;
      s.legs[0].rotation.x = sw; s.legs[1].rotation.x = -sw;
      s.arms[0].rotation.x = -1.3 + Math.sin(s.walk * 0.5) * 0.15;
      s.arms[1].rotation.x = -1.3 - Math.sin(s.walk * 0.5) * 0.15;
      s.body.rotation.z = Math.sin(s.walk * 0.5) * 0.1;
      s.body.rotation.x = 0.12;
      s.jaw.position.y = 1.5 - Math.abs(Math.sin(s.walk * 1.3)) * 0.04;
      s.rattleT -= dt;
      if (s.rattleT <= 0 && dist < 22) { s.rattleT = rrand(0.4, 0.8); audio.rattle(volAt(s.pos, 22) * 0.7, panTo(s.pos)); }
      if (dist < 0.85 && Math.abs(G.pos.y - s.pos.y) < 1.2) hurt(CFG.damage.skeleton, 'skeleton', s.pos);
      // lose interest and crumble back into the ground
      s.lostT = dist > 32 ? s.lostT + dt : 0;
      if (s.lostT > 6) { s.state = 'buried'; s.root.visible = false; s.pos.set(s.home.x, ground - 1.9, s.home.z); }
    }
    s.root.position.copy(s.pos);
  }
}

// ============================================================================
// Update: spiders
// ============================================================================
function updateSpiders(dt, t) {
  for (const s of spiders) {
    const h = s.house, reg = h.region;
    const playerHere = G.pos.x > reg.minX - 0.3 && G.pos.x < reg.maxX + 0.3 && G.pos.z > reg.minZ - 0.3 && G.pos.z < reg.maxZ + 0.3 && Math.abs(G.pos.y - h.f2) < 1.2;
    const dist = Math.hypot(G.pos.x - s.pos.x, G.pos.z - s.pos.z);
    s.hissT -= dt;
    if (s.state === 'dead') {
      // flip onto its back and curl its legs up
      s.dieT += dt;
      const k = Math.min(1, s.dieT / 0.6);
      s.root.rotation.z = Math.PI * k;
      s.root.position.set(s.pos.x, s.pos.y + 1.05 * k, s.pos.z);
      for (const L of s.legs) {
        L.knee.rotation.z = lerp(-L.s * 1.6, -L.s * 2.6, k) + (k < 1 ? Math.sin(s.dieT * 40 + L.i) * 0.3 : 0);
        L.hip.rotation.y = L.baseYaw;
      }
      s.thread.visible = false;
      s.deadT -= dt;
      // a new spider moves in once you've left this floor
      if (s.deadT <= 0 && !playerHere) { s.state = 'hanging'; s.pos.copy(h.spiderHang); reviveSpider(s); }
      continue;
    }
    if (s.stagger > 0) {
      s.stagger -= dt;
      s.pos.addScaledVector(s.knock, dt);
      s.knock.multiplyScalar(Math.exp(-8 * dt));
      s.pos.x = clamp(s.pos.x, reg.minX, reg.maxX); s.pos.z = clamp(s.pos.z, reg.minZ, reg.maxZ);
      s.root.position.copy(s.pos);
      s.root.rotation.x = -0.3 * (s.stagger / 0.5);
      continue;
    }
    s.root.rotation.x = 0;
    if (s.state === 'hanging') {
      s.pos.y = h.spiderHang.y + Math.sin(t * 1.3) * 0.08;
      s.root.rotation.y += dt * 0.3;
      if (playerHere && dist < 3.5) { s.state = 'dropping'; s.vy = 0; audio.hiss(0.9, panTo(s.pos)); rumble(0.5, 0.3, 200); }
    } else if (s.state === 'dropping') {
      s.vy -= GRAVITY * dt;
      s.pos.y = Math.max(h.f2, s.pos.y + s.vy * dt);
      if (s.pos.y === h.f2) { s.state = 'hunt'; s.timer = 0; }
    } else {
      const lit = inFlashBeam(_g.set(s.pos.x, s.pos.y + 0.5, s.pos.z), 12) && dist < 12;
      if (lit && s.state !== 'retreat') { s.state = 'retreat'; s.timer = 1.2; if (s.hissT <= 0) { s.hissT = 1.5; audio.hiss(volAt(s.pos, 14), panTo(s.pos)); } }
      let tx, tz, speed;
      if (s.state === 'retreat') {
        s.timer -= dt;
        tx = s.pos.x - (G.pos.x - s.pos.x); tz = s.pos.z - (G.pos.z - s.pos.z); speed = 3.2;
        if (s.timer <= 0) s.state = 'hunt';
      } else if (playerHere && dist < 10) {
        tx = G.pos.x; tz = G.pos.z; speed = 4.0;
      } else {
        if (!s.target || Math.hypot(s.target.x - s.pos.x, s.target.z - s.pos.z) < 0.5) s.target = { x: rrand(reg.minX, reg.maxX), z: rrand(reg.minZ, reg.maxZ) };
        tx = s.target.x; tz = s.target.z; speed = 1.1;
      }
      const a = Math.atan2(tx - s.pos.x, tz - s.pos.z);
      if (dist > 0.7 || s.state !== 'hunt') {
        s.pos.x += Math.sin(a) * speed * dt; s.pos.z += Math.cos(a) * speed * dt;
      }
      s.pos.x = clamp(s.pos.x, reg.minX, reg.maxX); s.pos.z = clamp(s.pos.z, reg.minZ, reg.maxZ);
      const ho = h.hole;
      if (s.pos.x > ho.minX && s.pos.x < ho.maxX && s.pos.z > ho.minZ && s.pos.z < ho.maxZ) {
        const opts = [[s.pos.x - ho.minX, 'x', ho.minX], [ho.maxX - s.pos.x, 'x', ho.maxX], [s.pos.z - ho.minZ, 'z', ho.minZ], [ho.maxZ - s.pos.z, 'z', ho.maxZ]].sort((p, q) => p[0] - q[0]);
        s.pos[opts[0][1]] = opts[0][2];
      }
      s.pos.y = h.f2;
      let diff = a - s.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      s.root.rotation.y += diff * Math.min(1, dt * 8);
      s.walk += dt * speed * 6;
      if (playerHere && dist < 0.95 && s.state === 'hunt') {
        hurt(CFG.damage.spider, 'spider', s.pos);
        s.state = 'retreat'; s.timer = 1.0;
        audio.hiss(0.9, panTo(s.pos));
      }
      if (playerHere && s.hissT <= 0 && dist < 8) { s.hissT = rrand(3, 6); audio.hiss(volAt(s.pos, 12) * 0.6, panTo(s.pos)); }
    }
    s.root.position.copy(s.pos);
    for (const L of s.legs) {
      L.hip.rotation.y = L.baseYaw + Math.sin(s.walk + L.i * 1.6 + (L.s > 0 ? 0 : Math.PI)) * 0.3;
    }
    s.thread.visible = s.state === 'hanging' || s.state === 'dropping';
    if (s.thread.visible) {
      const p = s.thread.geometry.attributes.position;
      p.setXYZ(0, s.pos.x, h.top - 0.2, s.pos.z);
      p.setXYZ(1, s.pos.x, s.pos.y + 0.9, s.pos.z);
      p.needsUpdate = true;
      s.thread.geometry.computeBoundingSphere();
    }
  }
}

// ============================================================================
// Pickups, cauldron, win
// ============================================================================
function updatePickups() {
  for (const c of candies) {
    if (c.taken) continue;
    const p = c.g.position;
    if (Math.hypot(p.x - G.pos.x, p.z - G.pos.z) < 1.4 && Math.abs(p.y - 1.1 - G.pos.y) < 1.2) {
      c.taken = true; c.g.visible = false;
      sparkBurst(c.g.position, 60, COLORS.candy, { speed: 3.5 });
      G.candies++;
      audio.pickup();
      rumble(0.2, 0.6, 150);
      const left = CFG.candyCount - G.candies;
      if (left === 0) {
        toast('All candy found! Get to the cauldron!', 3.5, '#6dff8f');
        cauldron.beam.visible = true;
        audio.giggle(0.9, 0); setTimeout(() => audio.giggle(0.9, 0), 700);
      } else if (G.candies === 4) toast('The Elf is getting restless…', 3, '#ff3b2f');
      else toast(`Cursed candy! ${left} to go`, 2.2);
      setObjective();
    }
  }
  for (const b of batteries) {
    if (b.taken) continue;
    const p = b.g.position;
    if (Math.hypot(p.x - G.pos.x, p.z - G.pos.z) < 1.3 && Math.abs(p.y - 0.6 - G.pos.y) < 1.2) {
      b.taken = true; b.g.visible = false;
      sparkBurst(b.g.position, 35, COLORS.battery, { speed: 2.5 });
      G.battery = Math.min(1, G.battery + 0.5);
      audio.powerup();
      toast('Fresh batteries!', 1.6, '#9dff4a');
    }
  }
  const canBanish = G.candies >= CFG.candyCount && Math.hypot(G.pos.x, G.pos.z) < 3.2;
  const pr = $('prompt');
  if (!canBanish && G.glare > 0.15) {
    pr.textContent = 'Keep the light on him… ' + '▮'.repeat(Math.ceil(G.glare / 1.5 * 8)).padEnd(8, '▯');
    pr.classList.remove('hidden');
    return false;
  }
  if (canBanish) { pr.textContent = touch.on ? 'Tap ✋ to drop the candy into the cauldron' : 'Press A / E to drop the candy into the cauldron'; pr.classList.remove('hidden'); }
  else pr.classList.add('hidden');
  return canBanish;
}

function startBanish() {
  setState('banishing');
  audio.banish();
  rumble(0.6, 0.8, 2500);
  G.banishFrom = G.elfPos.clone();
}

function updateBanish(dt) {
  G.banishT += dt;
  const t = Math.min(1, G.banishT / 2.4);
  const p = G.banishFrom.clone().lerp(new THREE.Vector3(0, 0, 0), t);
  p.y += Math.sin(t * Math.PI) * 4 + t * 0.6;
  elf.root.position.copy(p);
  elf.root.rotation.y += dt * (6 + t * 20);
  elf.root.scale.setScalar(Math.max(0.01, 1 - t * t));
  elf.arms[0].rotation.x = elf.arms[1].rotation.x = -2.8;
  elf.headPivot.rotation.z = Math.sin(G.banishT * 30) * 0.4;
  cauldron.light.intensity = 14 + Math.sin(G.banishT * 20) * 6 + t * 150;
  G.shake = 0.03;
  if (G.banishT > 2.6 && elf.root.visible) {
    elf.root.visible = false;
    cauldron.light.intensity = 300;
    sparkBurst(tmpV.set(0, 1.8, 0), 400, COLORS.banish, { speed: 8, size: 0.14, life: 2.4, grav: -3, up: 0.5 });
  }
  if (G.banishT > 4.2) {
    $('winStats').textContent = `Time: ${fmtTime(G.time)}`;
    setState('won');
  }
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function caught(by) {
  G.caughtBy = by;
  setState('caught');
  audio.scream();
  rumble(1, 1, 900);
  G.shake = 0.12;
  if (by === 'elf') {
    G.flashOn = true; G.battery = Math.max(G.battery, 0.3); G.flicker = 0;
    elf.headMat.emissiveIntensity = 10;
  }
  $('redflash').style.opacity = 1;
}

const DEATH_TEXT = {
  elf: ['He was right behind you the whole time.', "You looked away. He didn't.", 'He saw you first.', "He's making a list. You're on it."],
  ghost: ['A ghost passed right through you. Your courage ran out.'],
  skeleton: ['The skeletons rattled you to your bones.'],
  spider: ['Eight legs. Too many eyes. You fainted.'],
};

// ============================================================================
// Ambient world animation
// ============================================================================
const decoyV = new THREE.Vector3();
let candleAssignT = 0;
function candleFlicker(cl, t) {
  // dull and unsteady: slow sway, fast shimmer, and the odd gutter
  let f = 0.78 + 0.12 * Math.sin(t * 7.3 + cl.ph) + 0.07 * Math.sin(t * 13.1 + cl.ph * 2) + 0.05 * Math.random();
  if (Math.sin(t * 0.9 + cl.ph * 3) > 0.97) f *= 0.55;
  return f;
}
function updateCandles(dt, t) {
  const centre = state === 'title' ? camera.position : G.pos;
  candleAssignT -= dt;
  if (candleAssignT <= 0) {
    candleAssignT = 0.4;
    const nearest = candleClusters.slice().sort((a, b) => a.pos.distanceToSquared(centre) - b.pos.distanceToSquared(centre)).slice(0, candleLightPool.length);
    // keep lights on clusters that are still near, hand the rest to newly near clusters
    const free = candleLightPool.filter((p) => !nearest.includes(p.cluster));
    for (const cl of nearest) if (!candleLightPool.some((p) => p.cluster === cl)) { const p = free.pop(); if (p) { p.cluster = cl; cl.level = 0; } }
  }
  for (const cl of candleClusters) {
    const f = candleFlicker(cl, t);
    cl.f = f;
    for (const fl of cl.flames) fl.scale.set(0.9 + f * 0.15, 1.3 + f * 0.7, 0.9 + f * 0.15);
    for (const g of cl.glows) g.material.opacity = 0.3 + f * 0.2;
  }
  for (const p of candleLightPool) {
    const cl = p.cluster;
    if (!cl) { p.light.intensity = 0; continue; }
    cl.level = Math.min(1, cl.level + dt * 2);   // fade in when a light arrives
    p.light.position.set(cl.pos.x, cl.pos.y + 0.45, cl.pos.z);
    p.light.intensity = 6 * cl.f * cl.level * Math.min(1.4, 0.6 + cl.flames.length * 0.25);
  }
}
const _lm = new THREE.Matrix4(), _lq = new THREE.Quaternion(), _ls = new THREE.Vector3(1, 1, 1);
const leafWhirl = { active: false, cooldown: 12, t: 0, dur: 0, c: new THREE.Vector3() };
function updateWorld(dt, t) {
  wind.uTime.value = t;
  wind.uWind.value = 1 + 0.55 * Math.sin(t * 0.23) + 0.35 * Math.sin(t * 0.71 + 1.3);  // gusts
  const centre = state === 'title' ? camera.position : G.pos;
  const gust = wind.uWind.value;
  // every so often a gust whips up a whirlwind of leaves near you
  const W = leafWhirl;
  W.cooldown -= dt;
  if (!W.active && W.cooldown <= 0 && state === 'playing') {
    camera.getWorldDirection(tmpV2);
    const d = rrand(5, 9), side = rrand(-4, 4);
    W.c.set(centre.x + tmpV2.x * d - tmpV2.z * side, 0, centre.z + tmpV2.z * d + tmpV2.x * side);
    W.active = true; W.t = 0; W.dur = rrand(6, 9);
    audio.gust(0.7);
  }
  if (W.active) {
    W.t += dt;
    W.c.x += 0.5 * gust * dt; W.c.z += 0.3 * gust * dt;
    if (W.t > W.dur) { W.active = false; W.cooldown = rrand(22, 40); }
  }
  const whirlGround = W.active ? heightAt(W.c.x, W.c.z) : 0;
  fallingLeaves.items.forEach((L, i) => {
    if (W.active && i < 70) {
      const k = i / 70, ramp = Math.min(1, W.t / 1.5, (W.dur - W.t) / 1.5);
      const h = ((k * 5 + W.t * 0.6) % 5) * ramp;
      const a = W.t * (4 - k * 1.5) + i * 2.39, r = 0.4 + h * 0.5;
      tmpV.set(W.c.x + Math.cos(a) * r, whirlGround + 0.2 + h, W.c.z + Math.sin(a) * r);
      L.p.lerp(tmpV, Math.min(1, dt * 3));
      L.r.x += L.spin.x * dt * 2; L.r.y += L.spin.y * dt * 2;
      _lm.compose(L.p, _lq.setFromEuler(L.r), _ls);
      fallingLeaves.im.setMatrixAt(i, _lm);
      return;
    }
    const ground = heightAt(L.p.x, L.p.z);
    if (L.p.y < ground || L.p.distanceTo(centre) > 26) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 22;
      L.p.set(centre.x + Math.cos(a) * r, 0, centre.z + Math.sin(a) * r);
      L.p.y = heightAt(L.p.x, L.p.z) + rrand(3, 10);
    }
    L.p.x += (0.8 * gust + Math.sin(t * 1.7 + L.ph) * 0.6) * dt;
    L.p.z += (0.5 * gust + Math.cos(t * 1.3 + L.ph) * 0.6) * dt;
    L.p.y -= L.fall * dt;
    L.r.x += L.spin.x * dt; L.r.y += L.spin.y * dt; L.r.z += L.spin.z * dt;
    _lm.compose(L.p, _lq.setFromEuler(L.r), _ls);
    fallingLeaves.im.setMatrixAt(i, _lm);
  });
  fallingLeaves.im.instanceMatrix.needsUpdate = true;

  for (const p of pumpkins) {
    const f = 0.75 + 0.15 * Math.sin(t * 9 + p.phase) + 0.1 * Math.sin(t * 23.7 + p.phase * 3);
    p.mat.emissiveIntensity = p.base * f;
    if (p.light) p.light.intensity = 9 * f;
  }
  litWindowMats.forEach((m, i) => {
    const f = 0.85 + Math.sin(t * 7 + i) * 0.08 + (Math.random() < 0.01 ? -0.5 : 0);
    m.color.setScalar(f);
  });
  for (const h of houses) {
    h.candleLight.intensity = 8 * (0.8 + Math.random() * 0.25);
    for (const c of h.candles) c.scale.set(1, 1.6 + Math.random() * 0.5, 1);
  }
  updateCandles(dt, t);
  cauldron.flames.forEach((f, i) => {
    const s = 0.8 + Math.sin(t * 13 + i * 2.1) * 0.25 + Math.random() * 0.1;
    f.scale.set(1, s, 1);
    f.position.y = 0.2 + s * 0.15;
  });
  cauldron.bubbles.forEach((b) => {
    const ph = (t * 0.6 + b.userData.phase) % 1;
    b.position.set(b.userData.x, 1.75 + ph * 0.25, b.userData.z);
    b.scale.setScalar(ph < 0.85 ? ph + 0.3 : (1 - ph) * 6);
  });
  if (state !== 'banishing') cauldron.light.intensity = 13 + Math.sin(t * 3) * 2.5;
  cauldron.steam.material.opacity = 0.45 + Math.sin(t * 2) * 0.1;
  cauldron.beam.material.opacity = 0.14 + Math.sin(t * 3) * 0.05;
  cauldron.ring.material.opacity = 0.25 + Math.sin(t * 2) * 0.1;
  for (const m of mistLayers) { m.tex.offset.x = t * 0.004 * m.sp; m.tex.offset.y = t * 0.003 * m.sp; }
  wisps.seeds.forEach((s, i) => {
    wisps.pos[i * 3] = s.x + Math.sin(t * s.s + s.p) * 2;
    wisps.pos[i * 3 + 1] = s.y + Math.sin(t * s.s * 1.7 + s.p) * 0.5;
    wisps.pos[i * 3 + 2] = s.z + Math.cos(t * s.s * 0.8 + s.p) * 2;
  });
  wisps.g.attributes.position.needsUpdate = true;
  for (const b of bats) {
    const a = t * b.sp + b.p;
    b.g.position.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(t * 1.3 + b.p) * 1.5, b.cz + Math.sin(a) * b.r);
    b.g.rotation.y = -a + (b.sp > 0 ? 0 : Math.PI);
    const flap = Math.sin(t * 18 + b.p) * 0.9;
    b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
  }
  for (const c of candies) if (!c.taken) { c.m.rotation.y = t * 2; c.m.position.y = Math.sin(t * 2 + c.g.position.x) * 0.15; }
  for (const b of batteries) if (!b.taken) { b.m.rotation.y = t * 1.5; b.m.position.y = Math.sin(t * 2.5 + b.g.position.z) * 0.1; }
  const watchTarget = state === 'title' ? camera.position : G.pos;
  for (const d of decoys) {
    decoyV.setFromMatrixPosition(d.e.headPivot.matrixWorld);
    if (!onScreen(decoyV, 1.05)) {
      const local = d.shelf.worldToLocal(tmpV2.copy(watchTarget));
      d.e.headPivot.rotation.y = clamp(Math.atan2(local.x, local.z), -1.4, 1.4);
    }
  }
}

function updateHUD(dt) {
  $('candyCount').textContent = G.candies;
  if (touch.on) $('tUse').classList.toggle('hidden', state !== 'playing' || !(G.candies >= CFG.candyCount && Math.hypot(G.pos.x, G.pos.z) < 3.2));
  const bat = $('battery');
  bat.style.width = `${G.battery * 100}%`;
  bat.style.background = G.battery < 0.2 ? '#ff3b2f' : G.battery < 0.45 ? '#ffb02f' : '#ffe39a';
  $('stamina').style.width = `${G.stamina}%`;
  $('courage').style.width = `${G.courage}%`;
  const p = G.prox;
  $('vignette').style.background = `radial-gradient(ellipse at center, transparent ${45 - p * 25}%, rgba(${Math.round(p * 90)},0,0,${0.85 + p * 0.1}) 100%)`;
  if (state !== 'caught') $('redflash').style.opacity = G.hurtFlash * 0.7;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').style.opacity = 0; }
}

// ============================================================================
// Title / attract mode
// ============================================================================
function updateAttract(dt, t) {
  const a = t * 0.06;
  const cx = Math.sin(a) * 15, cz = Math.cos(a) * 15;
  camera.position.set(cx, heightAt(cx, cz) + 4.2 + Math.sin(t * 0.3) * 0.6, cz);
  camera.lookAt(0, 1.4, 0);
  const ea = a + 0.5;
  const ex = Math.sin(ea) * 6.2, ez = Math.cos(ea) * 6.2;
  elf.root.position.set(ex, heightAt(ex, ez), ez);
  elf.root.lookAt(camera.position.x, elf.root.position.y, camera.position.z);
  elf.root.visible = true;
  elf.legs[0].rotation.x = elf.legs[1].rotation.x = 0;
  elf.arms[0].rotation.x = elf.arms[1].rotation.x = 0;
  elf.headPivot.rotation.z = Math.sin(t * 0.7) * 0.25;
  for (const e of elf.eyes) e.material.opacity = 1;
  player.root.position.set(0, -10, 0);
  flashlight.intensity = 0;
}

// ============================================================================
// Main loop
// ============================================================================
let last = performance.now(), clockT = 0;
resetGame();
setState('title');

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; clockT += dt; stateTime += dt;
  const inp = readInput();
  if (inp.nextTrack && audio.ok) audio.nextTrack();
  if (inp.music && audio.ok) audio.toggleMusic();

  switch (state) {
    case 'title':
      updateAttract(dt, clockT);
      if (inp.settings) openSettings();
      else if (inp.jukebox) openJukebox();
      else if (inp.action) startGame();
      break;
    case 'jukebox':
      updateAttract(dt, clockT);
      updateJukebox(dt, inp);
      break;
    case 'settings':
      if (menu.ret === 'title') updateAttract(dt, clockT);
      updateSettingsMenu(dt, inp);
      break;
    case 'playing': {
      if (inp.pause) { setState('paused'); break; }
      G.time += dt;
      updatePlayer(dt, inp);
      updateCamera(dt);
      updateElf(dt);
      if (state !== 'playing') break;
      updateGhosts(dt, clockT);
      updateSkeletons(dt);
      updateSpiders(dt, clockT);
      if (state !== 'playing') break;
      if (updatePickups() && inp.action) startBanish();
      updateHUD(dt);
      break;
    }
    case 'paused':
      if (inp.settings) openSettings();
      else if (inp.pause || inp.action) setState('playing');
      break;
    case 'caught': {
      if (G.caughtBy === 'elf') {
        // jump scare: the elf lunges into your face
        camera.getWorldDirection(tmpV2);
        const k = Math.min(1, stateTime / 0.18);
        elf.root.position.copy(camera.position).addScaledVector(tmpV2, lerp(2.2, 0.75, k));
        elf.root.position.y = camera.position.y - 1.62 * 1.1;
        elf.root.scale.setScalar(1.1);
        elf.root.lookAt(camera.position.x, elf.root.position.y, camera.position.z);
        elf.arms[0].rotation.x = elf.arms[1].rotation.x = -1.6;
        elf.headPivot.rotation.z = Math.sin(stateTime * 40) * 0.12;
        for (const e of elf.eyes) e.material.opacity = 1;
        flashlight.position.copy(camera.position).addScaledVector(tmpV2, -0.2);
        flashlight.target.position.copy(elf.root.position).setY(camera.position.y);
        flashlight.target.updateMatrixWorld();
        flashlight.intensity = Math.random() < 0.8 ? 120 : 0;
      } else {
        G.pitch = lerp(G.pitch, 1.0, dt * 2);   // collapse to the ground
        updateCamera(dt);
      }
      camera.position.x += rrand(-1, 1) * 0.03; camera.position.y += rrand(-1, 1) * 0.03;
      $('redflash').style.opacity = 0.6 + Math.random() * 0.4;
      G.prox = 1; updateHUD(dt);
      if (stateTime > 1.7) {
        $('redflash').style.opacity = 0;
        $('goStats').textContent = `Candy found: ${G.candies} / ${CFG.candyCount}  ·  Survived ${fmtTime(G.time)}`;
        const lines = DEATH_TEXT[G.caughtBy] || DEATH_TEXT.elf;
        $('goText').textContent = lines[(Math.random() * lines.length) | 0];
        $('goTitle').textContent = G.caughtBy === 'elf' ? 'The Elf Got You' : 'Scared to Death';
        elf.root.scale.setScalar(1);
        elf.headMat.emissiveIntensity = 4;
        setState('gameover');
      }
      break;
    }
    case 'banishing':
      G.time += dt;
      updatePlayer(dt, { mx: 0, my: 0, lx: 0, ly: 0, mouseDX: 0, mouseDY: 0 });
      updateCamera(dt);
      updateBanish(dt);
      updateHUD(dt);
      break;
    case 'gameover':
    case 'won':
      if (inp.action && stateTime > 0.8) startGame();
      G.prox = lerp(G.prox, 0, dt * 2);
      updateHUD(dt);
      break;
  }

  updateWorld(dt, clockT);
  updateParticles(dt, clockT);
  audio.update(dt, state === 'playing' ? G.prox : 0);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// handy for debugging from the console
window.__game = { G, CFG, scene, camera, setState, startGame, houses, ghosts, skeletons, spiders, heightAt, trail, clearPath, blockedAt, solids, circles, bushes, audio, TRACKS, SETTINGS };
