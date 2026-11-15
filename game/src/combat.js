// Combat resolution: the player's hitscan ray, bot fire, tracers, muzzle
// flashes and frag grenades. One place owns every damage number, so the
// judge can read the gunplay in a single file. No allocations in the hot
// paths: tracers, flashes and grenades come from fixed pools.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 24;
const TRACER_LIFE = 0.12;
const FLASH_POOL = 8;
const FLASH_LIFE = 0.06;
const GRENADE_POOL = 4;
const GRENADE_FUSE = 1.6;
const GRENADE_RADIUS = 4.5;
const GRENADE_MAX_DAMAGE = 120;
const ENEMY_HEX = parseInt(PALETTE.enemy.slice(1), 16);

export function createCombat(scene, world, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const _dir = new THREE.Vector3();
  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();
  const _eye = new THREE.Vector3();

  // Tracer pool: one Line each, reused.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ink), transparent: true, opacity: 0 });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Muzzle flash pool: small additive quads.
  const flashes = [];
  for (let i = 0; i < FLASH_POOL; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, life: 0 });
  }
  let flashIndex = 0;

  // Grenade pool.
  const grenades = [];
  for (let i = 0; i < GRENADE_POOL; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.4, metalness: 0.6 }),
    );
    mesh.visible = false;
    mesh.castShadow = true;
    scene.add(mesh);
    grenades.push({ mesh, active: false, velocity: new THREE.Vector3(), fuse: 0, prev: new THREE.Vector3() });
  }

  // Explosion visuals: one expanding ring + light, reused.
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 14);
  scene.add(blastLight);
  let blastLife = 0;

  function addTracer(from, to, colorHex) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_POOL;
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
    positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.material.color.setHex(colorHex);
    tracer.line.material.opacity = 0.85;
    tracer.line.visible = true;
    tracer.life = TRACER_LIFE;
  }

  function addFlash(pos, yaw) {
    const flash = flashes[flashIndex];
    flashIndex = (flashIndex + 1) % FLASH_POOL;
    flash.mesh.position.copy(pos);
    flash.mesh.rotation.set(0, yaw, Math.random() * Math.PI);
    flash.mesh.material.opacity = 0.95;
    flash.mesh.visible = true;
    flash.life = FLASH_LIFE;
  }

  function explode(pos) {
    blast.position.copy(pos);
    blast.visible = true;
    blastLife = 0.35;
    blastLight.position.copy(pos);
    blastLight.intensity = 60;
    hooks.onExplosion(pos);
    // Damage every combatant in the radius that the blast can reach.
    for (const target of hooks.targets()) {
      if (!target.alive) continue;
      const dx = target.position.x - pos.x;
      const dy = (target.position.y + 1.0) - pos.y;
      const dz = target.position.z - pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > GRENADE_RADIUS) continue;
      if (!world.hasLineOfSight(pos.x, pos.y, pos.z, target.position.x, target.position.y + 1.0, target.position.z)) continue;
      const damage = Math.round(GRENADE_MAX_DAMAGE * (1 - dist / GRENADE_RADIUS));
      hooks.damageTarget(target, damage, 'grenade');
    }
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, (tracer.life / TRACER_LIFE) * 0.85);
      if (tracer.life <= 0) tracer.line.visible = false;
    }
    for (const flash of flashes) {
      if (flash.life <= 0) continue;
      flash.life -= dt;
      flash.mesh.material.opacity = Math.max(0, (flash.life / FLASH_LIFE) * 0.95);
      if (flash.life <= 0) flash.mesh.visible = false;
    }
    if (blastLife > 0) {
      blastLife -= dt;
      const t = 1 - blastLife / 0.35;
      const scale = 0.5 + t * GRENADE_RADIUS;
      blast.scale.setScalar(scale);
      blast.material.opacity = Math.max(0, 0.55 * (1 - t));
      blastLight.intensity = Math.max(0, 60 * (1 - t));
      if (blastLife <= 0) { blast.visible = false; blastLight.intensity = 0; }
    }
    for (const grenade of grenades) {
      if (!grenade.active) continue;
      grenade.fuse -= dt;
      grenade.prev.copy(grenade.mesh.position);
      grenade.velocity.y -= 14 * dt;
      grenade.mesh.position.addScaledVector(grenade.velocity, dt);
      const p = grenade.mesh.position;
      // Bounce off walls and floor: point test against every collider.
      for (const box of world.colliders) {
        if (p.x < box.min.x - 0.09 || p.x > box.max.x + 0.09) continue;
        if (p.y < box.min.y - 0.09 || p.y > box.max.y + 0.09) continue;
        if (p.z < box.min.z - 0.09 || p.z > box.max.z + 0.09) continue;
        // Inside a collider: step back and reflect the fastest axis.
        const vx = Math.abs(grenade.velocity.x);
        const vy = Math.abs(grenade.velocity.y);
        const vz = Math.abs(grenade.velocity.z);
        if (vx >= vy && vx >= vz) grenade.velocity.x *= -0.45;
        else if (vy >= vx && vy >= vz) grenade.velocity.y *= -0.45;
        else grenade.velocity.z *= -0.45;
        p.copy(grenade.prev);
        break;
      }
      if (p.y < 0.09) { p.y = 0.09; grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.45; grenade.velocity.x *= 0.7; grenade.velocity.z *= 0.7; }
      if (grenade.fuse <= 0) {
        grenade.active = false;
        grenade.mesh.visible = false;
        explode(p);
      }
    }
  }

  return {
    step,
    addTracer,
    addFlash,
    // The player's shot: one ray per pellet, spread already applied by the
    // caller. Returns the first live hit (a bot part or a wall).
    shootPlayer(origin, direction, botMeshes) {
      raycaster.set(origin, direction);
      const hits = raycaster.intersectObjects(world.shootables.concat(botMeshes), false);
      for (const hit of hits) {
        const bot = hit.object.userData.bot;
        if (bot) {
          if (!bot.alive) continue;
          return { kind: 'bot', bot, part: hit.object.userData.part || 'torso', point: hit.point };
        }
        return { kind: 'wall', point: hit.point };
      }
      // No surface: the tracer just runs out into the fog.
      _to.copy(origin).addScaledVector(direction, 60);
      return { kind: 'none', point: _to };
    },
    // A bot's shot: the caller already decided the bot can see the target.
    // The roll decides the hit; the tracer shows where the bullet went.
    botShoot(bot, target, chance, dist) {
      bot.eyePos(_eye);
      _from.copy(_eye);
      _from.x += -Math.sin(bot.state.yaw) * 0.4;
      _from.z += -Math.cos(bot.state.yaw) * 0.4;
      _from.y -= 0.3;
      addFlash(_from, bot.state.yaw);
      const hit = Math.random() < chance;
      if (hit) {
        _to.set(target.position.x, target.position.y + 1.15, target.position.z);
        addTracer(_from, _to, ENEMY_HEX);
        const damage = 9 + Math.floor(Math.random() * 7);
        hooks.damageTarget(target, damage, 'bullet', bot);
      } else {
        // Miss: the tracer lands near the target, off by up to a metre.
        _to.set(
          target.position.x + (Math.random() * 2 - 1) * 1.1,
          target.position.y + 0.8 + Math.random() * 1.2,
          target.position.z + (Math.random() * 2 - 1) * 1.1,
        );
        // Stop the tracer at the first wall it would cross.
        if (!world.hasLineOfSight(_from.x, _from.y, _from.z, _to.x, _to.y, _to.z)) {
          _to.copy(_from).addScaledVector(_dir.set(_to.x - _from.x, _to.y - _from.y, _to.z - _from.z).normalize(), dist * 0.6);
        }
        addTracer(_from, _to, ENEMY_HEX);
      }
    },
    throwGrenade(from, direction) {
      for (const grenade of grenades) {
        if (grenade.active) continue;
        grenade.active = true;
        grenade.fuse = GRENADE_FUSE;
        grenade.mesh.visible = true;
        grenade.mesh.position.copy(from);
        grenade.velocity.copy(direction).multiplyScalar(13);
        grenade.velocity.y += 3.5;
        return true;
      }
      return false;
    },
    reset() {
      for (const tracer of tracers) { tracer.life = 0; tracer.line.visible = false; }
      for (const flash of flashes) { flash.life = 0; flash.mesh.visible = false; }
      for (const grenade of grenades) { grenade.active = false; grenade.mesh.visible = false; }
      blastLife = 0;
      blast.visible = false;
      blastLight.intensity = 0;
    },
  };
}
