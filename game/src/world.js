// BREACHLINE — the map: "Annex 9", a close-quarters indoor facility.
// Rooms and corridors built from boxes; every box is a collider for movement
// and a surface a bullet stops on. Plain geometry only, no models, no textures.
// Layout (top-down, north is -z): staging in the south, a central corridor,
// a west storage wing and an east lab wing, and the core hall in the north
// where the DATA CORE objective terminal sits.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 3.6;

// Bot navigation graph: nodes the bots walk between, with edges by index.
const NODES = [
  [0, 9.4], // 0 staging
  [0, 5.2], // 1 corridor south
  [0, 0.4], // 2 corridor mid
  [-3.4, 3.0], // 3 west door
  [-8.5, 2.5], // 4 west wing
  [3.4, 3.0], // 5 east door
  [8.5, 2.5], // 6 east wing
  [-8.5, -5.5], // 7 core hall west
  [8.5, -5.5], // 8 core hall east
  [0, -5.2], // 9 core hall mid — clears the pillar corners on the hall edges
  [0, -8.2], // 10 objective
  [-11.5, -5.5], // 11 far west hall
  [11.5, -5.5], // 12 far east hall
  [-8.5, -0.2], // 13 west wing north
  [8.5, -0.2], // 14 east wing north
  [0, -1.0], // 15 corridor north door
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [2, 5], [2, 15], [3, 4], [5, 6],
  [4, 13], [6, 14], [15, 9], [9, 7], [9, 8],
  [9, 10], [7, 11], [8, 12],
];

// Cover spots: a place to crouch behind, and the yaw to face while holding it.
// Each spot sits just clear of its crate or pillar (never inside one). The
// hall crates sit too close to the z=-2 wall for a south-side spot, so theirs
// are on the corridor side, facing the doors the player breaches through.
const COVER = [
  { x: -3.7, z: -4.2, yaw: -1.57 },
  { x: 3.7, z: -4.2, yaw: 1.57 },
  { x: -9.0, z: -6.2, yaw: Math.PI + 0.3 },
  { x: 9.0, z: -6.2, yaw: Math.PI - 0.3 },
  { x: -1.8, z: -5.0, yaw: Math.PI },
  { x: 1.8, z: -5.0, yaw: Math.PI },
  { x: -6.0, z: 2.8, yaw: -1.9 },
  { x: 6.0, z: 2.8, yaw: 1.9 },
  { x: -1.2, z: 4.9, yaw: Math.PI },
  { x: 1.2, z: 4.9, yaw: Math.PI },
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of ['canvas', 'surface', 'hairline', 'ink', 'muted', 'accent', 'ally', 'enemy']) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: 0.04,
    });
  }
  const glowAmber = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 1.6, roughness: 0.4,
  });
  const glowTeal = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.ally), emissive: new THREE.Color(PALETTE.ally),
    emissiveIntensity: 1.2, roughness: 0.4,
  });

  const colliders = [];
  const shootables = [];
  const minimapRects = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material] || material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      minimapRects.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
    }
    return mesh;
  }

  // Floor: one slab, plus darker inset panels to read as floor plates.
  box(28.6, 0.4, 21.6, 0, -0.2, 0.5, 'canvas');
  for (let gx = -12; gx <= 12; gx += 4) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 21), materials.hairline);
    strip.position.set(gx, 0.01, 0.5);
    strip.receiveShadow = true;
    group.add(strip);
  }

  // Outer walls.
  box(28.6, WALL_H, 0.5, 0, WALL_H / 2, -10.25, 'surface'); // north
  box(28.6, WALL_H, 0.5, 0, WALL_H / 2, 11.25, 'surface'); // south
  box(0.5, WALL_H, 21.6, -14.25, WALL_H / 2, 0.5, 'surface'); // west
  box(0.5, WALL_H, 21.6, 14.25, WALL_H / 2, 0.5, 'surface'); // east

  // Wall z=7 (staging / mid), door gap x -3..3.
  box(11.4, WALL_H, 0.5, -8.6, WALL_H / 2, 7, 'surface');
  box(11.4, WALL_H, 0.5, 8.6, WALL_H / 2, 7, 'surface');
  box(6.4, 0.7, 0.5, 0, WALL_H - 0.35, 7, 'hairline'); // lintel over the door

  // Wall z=-2 (mid / core hall), door gap x -2..2.
  box(12.4, WALL_H, 0.5, -8.2, WALL_H / 2, -2, 'surface');
  box(12.4, WALL_H, 0.5, 8.2, WALL_H / 2, -2, 'surface');
  box(4.4, 0.7, 0.5, 0, WALL_H - 0.35, -2, 'hairline');

  // Wall x=-3 (corridor / west wing), door gap z 2..4.
  box(0.5, WALL_H, 5.4, -3, WALL_H / 2, -0.4, 'surface');
  box(0.5, WALL_H, 0.5, -3, WALL_H / 2, 4.9, 'surface');
  box(0.5, 0.7, 2.4, -3, WALL_H - 0.35, 3, 'hairline');
  // Wall x=3 (corridor / east wing), door gap z 2..4.
  box(0.5, WALL_H, 5.4, 3, WALL_H / 2, -0.4, 'surface');
  box(0.5, WALL_H, 0.5, 3, WALL_H / 2, 4.9, 'surface');
  box(0.5, 0.7, 2.4, 3, WALL_H - 0.35, 3, 'hairline');

  // Cover: low crates to crouch behind, tall pillars, lab benches, server racks.
  box(1.6, 1.05, 1.6, -5.2, 0.525, -4.2, 'hairline');
  box(1.6, 1.05, 1.6, 5.2, 0.525, -4.2, 'hairline');
  box(1.4, 1.05, 1.4, -9.0, 0.525, -7.6, 'hairline');
  box(1.4, 1.05, 1.4, 9.0, 0.525, -7.6, 'hairline');
  box(1.2, 1.05, 2.4, -6.0, 0.525, 1.0, 'hairline');
  box(1.2, 1.05, 2.4, 6.0, 0.525, 1.0, 'hairline');
  box(1.1, 1.05, 1.1, -1.2, 0.525, 3.4, 'hairline');
  box(1.1, 1.05, 1.1, 1.2, 0.525, 3.4, 'hairline');
  box(1.0, 1.05, 1.0, -11.5, 0.525, 5.5, 'hairline');
  box(1.0, 1.05, 1.0, 11.5, 0.525, 5.5, 'hairline');
  box(1.0, 2.6, 1.0, -1.8, 1.3, -6.4, 'surface');
  box(1.0, 2.6, 1.0, 1.8, 1.3, -6.4, 'surface');
  box(1.0, 2.6, 1.0, -8.5, 1.3, 5.2, 'surface');
  box(1.0, 2.6, 1.0, 8.5, 1.3, 5.2, 'surface');
  // Server racks flanking the objective, and lab benches against the wing walls.
  box(0.9, 2.2, 2.2, -4.2, 1.1, -8.6, 'hairline');
  box(0.9, 2.2, 2.2, 4.2, 1.1, -8.6, 'hairline');
  box(1.0, 0.95, 3.4, -12.8, 0.475, 2.5, 'hairline');
  box(1.0, 0.95, 3.4, 12.8, 0.475, 2.5, 'hairline');

  // Objective terminal: the DATA CORE on the north wall.
  const terminal = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.7), materials.surface);
  terminal.position.set(0, 1.2, -9.7);
  terminal.castShadow = true;
  terminal.receiveShadow = true;
  group.add(terminal);
  colliders.push(new THREE.Box3().setFromObject(terminal));
  shootables.push(terminal);
  minimapRects.push({ x0: -1.2, z0: -10.05, x1: 1.2, z1: -9.35 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.3), glowAmber);
  screen.position.set(0, 1.5, -9.33);
  group.add(screen);
  const coreLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 30, 14);
  coreLight.position.set(0, 2.4, -8.2);
  scene.add(coreLight);

  // Hanging light fixtures: small glow bars with point lights, one per room.
  const fixtureSpots = [[0, 9.4], [0, 2.5], [-8.5, 2.5], [8.5, 2.5], [-8.5, -5.5], [8.5, -5.5]];
  for (const [fx, fz] of fixtureSpots) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.3), glowTeal);
    bar.position.set(fx, 3.3, fz);
    group.add(bar);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.ally), 22, 15);
    light.position.set(fx, 3.0, fz);
    scene.add(light);
  }

  // Ambient: a sky/ground gradient plus a soft key so shadows read.
  scene.add(new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.canvas), 1.4));
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.0);
  key.position.set(10, 16, 8);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -16;
  key.shadow.camera.far = 50;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  // Segment vs AABB slab test, reusing module-scope temporaries: no allocation
  // in the hot path, so bot sight checks stay cheap at 60 Hz.
  const _t = { min: 0, max: 0 };
  function segmentHitsBox(ax, ay, az, bx, by, bz, box3) {
    let tmin = 0;
    let tmax = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const mins = [box3.min.x, box3.min.y, box3.min.z];
    const maxs = [box3.max.x, box3.max.y, box3.max.z];
    const origins = [ax, ay, az];
    const dirs = [dx, dy, dz];
    for (let i = 0; i < 3; i += 1) {
      const d = dirs[i];
      if (Math.abs(d) < 1e-9) {
        if (origins[i] < mins[i] || origins[i] > maxs[i]) return false;
      } else {
        let t1 = (mins[i] - origins[i]) / d;
        let t2 = (maxs[i] - origins[i]) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
      }
    }
    _t.min = tmin;
    _t.max = tmax;
    return true;
  }

  function hasLineOfSight(ax, ay, az, bx, by, bz) {
    for (const collider of colliders) {
      if (segmentHitsBox(ax, ay, az, bx, by, bz, collider)) return false;
    }
    return true;
  }

  // Breadth-first path over the nav graph, returned as a list of node indices.
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < NODES.length; i += 1) {
      const dx = NODES[i][0] - x;
      const dz = NODES[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    if (start === goal) return [goal];
    const prev = new Array(NODES.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adjacency[current]) {
        if (prev[next] !== -1) continue;
        prev[next] = current;
        if (next === goal) {
          const path = [goal];
          let node = goal;
          while (node !== start) {
            node = prev[node];
            path.unshift(node);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [goal];
  }

  return {
    colliders,
    shootables,
    minimapRects,
    nodes: NODES,
    cover: COVER,
    objective: new THREE.Vector3(0, 1.4, -9.3),
    plantZone: { x: 0, z: -8.2, radius: 2.4 },
    playerSpawn: { x: 0, z: 9.8, yaw: 0 },
    allySpawn: { x: -1.8, z: 9.8, yaw: 0 },
    enemySpawns: [
      { x: -11, z: -7.5, yaw: 0.5 },
      { x: 11, z: -7.5, yaw: -0.5 },
      { x: -6, z: -6.5, yaw: 0.3 },
      { x: 6, z: -6.5, yaw: -0.3 },
    ],
    hasLineOfSight,
    findPath,
    nearestNode,
  };
}
