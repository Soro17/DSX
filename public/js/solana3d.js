// 3D Solana ecosystem scene: a SOL coin with ecosystem token coins in orbit (three.js).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SOL_PATH = 'M6.2 15.6a.6.6 0 0 1 .43-.18h14.1c.27 0 .4.32.21.51l-2.8 2.8a.6.6 0 0 1-.43.18H3.6a.3.3 0 0 1-.21-.51l2.8-2.8Zm0-10.45A.62.62 0 0 1 6.63 5h14.1c.27 0 .4.32.21.51l-2.8 2.8a.6.6 0 0 1-.43.18H3.6a.3.3 0 0 1-.21-.51l2.8-2.83Zm11.51 5.2a.6.6 0 0 0-.43-.18H3.18c-.27 0-.4.32-.21.51l2.8 2.8c.11.11.27.18.43.18h14.1c.27 0 .4-.32.21-.51l-2.8-2.8Z';

function faceTexture({ base, base2, glyph, ink, ring, sol = false }) {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s * 0.35, s * 0.3, s * 0.05, s / 2, s / 2, s / 2);
  grd.addColorStop(0, base2);
  grd.addColorStop(1, base);
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  g.strokeStyle = ring;
  g.lineWidth = 6;
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.43, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.setLineDash([3, 9]);
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.39, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  if (sol) {
    const scale = 11;
    g.save();
    g.translate(s / 2 - 12 * scale, s / 2 - 12 * scale);
    g.scale(scale, scale);
    const lg = g.createLinearGradient(3, 20, 21, 4);
    lg.addColorStop(0, '#9945FF');
    lg.addColorStop(0.5, '#5B6CFF');
    lg.addColorStop(1, '#14F195');
    g.shadowColor = 'rgba(20,241,149,0.45)';
    g.shadowBlur = 2;
    g.fillStyle = lg;
    g.fill(new Path2D(SOL_PATH));
    g.restore();
  } else {
    const size = glyph.length > 3 ? 120 : glyph.length > 2 ? 140 : 200;
    g.font = `700 ${size}px Sora, Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillText(glyph, s / 2 + 4, s / 2 + 12);
    g.fillStyle = ink;
    g.fillText(glyph, s / 2, s / 2 + 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI / 2; // cylinder cap UVs run sideways once the coin faces the camera
  return tex;
}

function makeCoin({ radius = 1, thickness = 0.16, rim, face }) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radius, radius, thickness, 96, 1);
  geo.rotateX(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: rim, metalness: 1, roughness: 0.25 });
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(face), metalness: 0.8, roughness: 0.3 });
  group.add(new THREE.Mesh(geo, [rimMat, faceMat, faceMat]));
  const lip = new THREE.TorusGeometry(radius * 0.965, thickness * 0.16, 12, 96);
  for (const z of [thickness / 2, -thickness / 2]) {
    const m = new THREE.Mesh(lip, rimMat);
    m.position.z = z;
    group.add(m);
  }
  return group;
}

export function mountSolanaScene(container) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 4, 6);
  scene.add(key);
  const purple = new THREE.PointLight(0x9945ff, 60, 22);
  purple.position.set(-4, 2, 3);
  scene.add(purple);
  const green = new THREE.PointLight(0x14f195, 45, 22);
  green.position.set(4, -2, 3);
  scene.add(green);

  const world = new THREE.Group();
  scene.add(world);

  const sol = makeCoin({
    radius: 1.7, thickness: 0.28, rim: 0x2a1f45,
    face: { base: '#0b0b16', base2: '#272044', ring: 'rgba(153,69,255,0.6)', sol: true },
  });
  world.add(sol);

  const eco = [
    { glyph: 'JTO', base: '#1c5a4b', base2: '#7ee3c4', ink: '#04241b', rim: 0x7ee3c4 },
    { glyph: 'PYTH', base: '#3b2c7a', base2: '#c7b2ff', ink: '#170d3d', rim: 0xc7b2ff },
    { glyph: 'RAY', base: '#1d4f63', base2: '#5ac4be', ink: '#031b22', rim: 0x5ac4be },
    { glyph: 'BONK', base: '#a3570a', base2: '#ffc061', ink: '#3a1d00', rim: 0xf7a531 },
    { glyph: 'WIF', base: '#6b4a2c', base2: '#e2c09a', ink: '#2a1a0b', rim: 0xc9a074 },
    { glyph: 'HNT', base: '#22258f', base2: '#8a8dff', ink: '#f0f0ff', rim: 0x474dff },
    { glyph: 'RN', base: '#7a1515', base2: '#ff7a7a', ink: '#fff0f0', rim: 0xff4a4a },
    { glyph: 'ORCA', base: '#8a6a10', base2: '#ffe28a', ink: '#3a2a00', rim: 0xffd15c },
  ].map((o, i, arr) => {
    const coin = makeCoin({ radius: 0.48, thickness: 0.1, rim: o.rim, face: { ...o, ring: 'rgba(255,255,255,0.35)' } });
    world.add(coin);
    return { coin, phase: (i / arr.length) * Math.PI * 2, orbit: i % 2 ? 3.3 : 2.75, speed: i % 2 ? 0.22 : 0.3, tilt: i % 2 ? -0.5 : 0.45 };
  });

  for (const [radius, color, rx, op] of [[2.75, 0x9945ff, 1.2, 0.45], [3.3, 0x14f195, 1.35, 0.35]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.01, 8, 220), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op }));
    ring.rotation.x = rx;
    world.add(ring);
  }

  const target = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    const r = container.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width - 0.5) * 0.45;
    target.y = ((e.clientY - r.top) / r.height - 0.5) * 0.3;
  }, { passive: true });

  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = width / height < 1 ? 13.5 : 10;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(container);

  const clock = new THREE.Clock();
  const frame = () => {
    const t = reduce ? 2 : clock.getElapsedTime();
    sol.rotation.y = Math.sin(t * 0.45) * 0.5;
    sol.rotation.x = 0.12 + Math.sin(t * 0.6) * 0.06;
    sol.position.y = Math.sin(t * 0.9) * 0.08;
    for (const o of eco) {
      const a = o.phase + t * o.speed;
      o.coin.position.set(Math.cos(a) * o.orbit, Math.sin(a) * o.tilt, Math.sin(a) * o.orbit * 0.5);
      o.coin.rotation.set(0.25, a * 1.4, 0.1);
    }
    world.rotation.y += (target.x - world.rotation.y) * 0.05;
    world.rotation.x += (target.y - world.rotation.x) * 0.05;
    renderer.render(scene, camera);
  };
  if (reduce) { frame(); window.addEventListener('resize', frame); } else renderer.setAnimationLoop(() => { if (visible) frame(); });
}
