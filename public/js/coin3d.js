// 3D hero: a DSX coin with asset coins orbiting it (three.js).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

function faceTexture({ base, base2, glyph, ink, ring, font = 'Space Grotesk' }) {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s * 0.35, s * 0.3, s * 0.05, s / 2, s / 2, s / 2);
  grd.addColorStop(0, base2);
  grd.addColorStop(1, base);
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  // engraved rings
  g.strokeStyle = ring;
  g.lineWidth = 6;
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.43, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.setLineDash([3, 9]);
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.39, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  // glyph
  const size = glyph.length > 2 ? 150 : 230;
  g.font = `700 ${size}px "${font}", Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillText(glyph, s / 2 + 4, s / 2 + 10);
  g.fillStyle = ink;
  g.fillText(glyph, s / 2, s / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // cylinder cap UVs run sideways once the coin is turned to face the camera
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI / 2;
  tex.anisotropy = 8;
  return tex;
}

function makeCoin({ radius = 1, thickness = 0.16, rim, face }) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radius, radius, thickness, 96, 1);
  geo.rotateX(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: rim, metalness: 1, roughness: 0.28 });
  const tex = faceTexture(face);
  const faceMat = (map) => new THREE.MeshStandardMaterial({ map, metalness: 0.85, roughness: 0.32 });
  const faceMaterial = faceMat(tex);
  group.add(new THREE.Mesh(geo, [rimMat, faceMaterial, faceMaterial]));
  // raised rim on both faces
  const lip = new THREE.TorusGeometry(radius * 0.965, thickness * 0.16, 12, 96);
  for (const z of [thickness / 2, -thickness / 2]) {
    const m = new THREE.Mesh(lip, rimMat);
    m.position.z = z;
    group.add(m);
  }
  return group;
}

export function mountCoinScene(container) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 4, 6);
  scene.add(key);
  const lime = new THREE.PointLight(0xc8ff3d, 30, 20);
  lime.position.set(-4, -1, 3);
  scene.add(lime);
  const violet = new THREE.PointLight(0x8b6cff, 40, 20);
  violet.position.set(4, 2, -2);
  scene.add(violet);

  const world = new THREE.Group();
  scene.add(world);

  // hero coin
  const hero = makeCoin({
    radius: 1.55, thickness: 0.26, rim: 0x2a2f3a,
    face: { base: '#151922', base2: '#3a4150', glyph: 'DSX', ink: '#c8ff3d', ring: 'rgba(200,255,61,0.55)' },
  });
  hero.rotation.set(0.25, -0.5, 0.05);
  world.add(hero);

  // orbiting asset coins
  const orbiters = [
    { glyph: '₿', base: '#c46a07', base2: '#ffb648', ink: '#fff4dc', rim: 0xf7931a, r: 0.55, orbit: 2.9, speed: 0.32, phase: 0.2, tilt: 0.35, y: 0.2 },
    { glyph: 'Au', base: '#a8781b', base2: '#ffe08a', ink: '#5a3c00', rim: 0xf4c55b, r: 0.6, orbit: 3.2, speed: 0.26, phase: 2.3, tilt: -0.25, y: -0.4 },
    { glyph: 'Ξ', base: '#3b2f8f', base2: '#a497ff', ink: '#f1eeff', rim: 0x8b6cff, r: 0.45, orbit: 2.6, speed: 0.4, phase: 4.1, tilt: 0.5, y: 0.6 },
    { glyph: 'Ag', base: '#7d8794', base2: '#f3f6fa', ink: '#2a3038', rim: 0xd5dbe3, r: 0.42, orbit: 3.5, speed: 0.22, phase: 5.2, tilt: -0.4, y: 0.9 },
    { glyph: '$', base: '#0f7a55', base2: '#4ef0b2', ink: '#eafff6', rim: 0x22d39a, r: 0.38, orbit: 2.4, speed: 0.45, phase: 1.1, tilt: 0.2, y: -1.0 },
  ].map((o) => {
    const coin = makeCoin({
      radius: o.r, thickness: o.r * 0.18, rim: o.rim,
      face: { base: o.base, base2: o.base2, glyph: o.glyph, ink: o.ink, ring: 'rgba(255,255,255,0.35)' },
    });
    world.add(coin);
    return { ...o, coin };
  });

  // orbit rings
  for (const [radius, color, rx, op] of [[2.9, 0xc8ff3d, 1.25, 0.35], [3.4, 0x8b6cff, 1.4, 0.3]]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.008, 8, 200),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op }),
    );
    ring.rotation.x = rx;
    world.add(ring);
  }

  // pointer parallax
  const target = { x: 0, y: 0 };
  const onMove = (e) => {
    const r = container.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width - 0.5) * 0.5;
    target.y = ((e.clientY - r.top) / r.height - 0.5) * 0.35;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // pull back on narrow screens so orbiters stay in frame
    camera.position.z = width / height < 1 ? 12 : 9;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(container);

  const clock = new THREE.Clock();
  const frame = () => {
    const t = reduce ? 1.5 : clock.getElapsedTime();
    hero.rotation.y = -0.5 + Math.sin(t * 0.5) * 0.45;
    hero.rotation.x = 0.25 + Math.sin(t * 0.7) * 0.06;
    hero.position.y = Math.sin(t * 0.9) * 0.08;
    for (const o of orbiters) {
      const a = o.phase + t * o.speed;
      o.coin.position.set(Math.cos(a) * o.orbit, o.y + Math.sin(a) * o.tilt + Math.sin(t + o.phase) * 0.08, Math.sin(a) * o.orbit * 0.55);
      o.coin.rotation.set(0.3 + Math.sin(t + o.phase) * 0.2, a * 1.6, 0.15);
    }
    world.rotation.y += (target.x - world.rotation.y) * 0.05;
    world.rotation.x += (target.y - world.rotation.x) * 0.05;
    renderer.render(scene, camera);
  };

  if (reduce) {
    frame();
    window.addEventListener('resize', frame);
  } else {
    renderer.setAnimationLoop(() => { if (visible) frame(); });
  }
}
