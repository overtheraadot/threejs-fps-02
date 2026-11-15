// Bot AI: one squadmate and four hostiles. Every bot runs the same brain:
// patrol routes, hold cover, engage on sight, flank a pinned target, retreat
// to cover when hurt, and converge on the objective when the charge is planted.
// Bots see through the same segment-vs-wall test the map uses, hear gunfire,
// and fire in bursts with distance-based accuracy, so they are beatable but
// punish a player who stands in the open.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMover } from './player.js';

const EYE = 1.5;
const HEALTH = 100;
const PERCEIVE_EVERY = 0.15;
const SIGHT_RANGE = 26;
const HEAR_RANGE = 18;

function buildBody(scene, colorHex, isAlly) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.6, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(isAlly ? PALETTE.ally : PALETTE.enemy),
    emissive: new THREE.Color(isAlly ? PALETTE.ally : PALETTE.enemy),
    emissiveIntensity: 0.9, roughness: 0.4,
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
  torso.position.y = 1.0;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), darkMat);
  head.position.y = 1.55;
  head.userData.part = 'head';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.05), visorMat);
  visor.position.set(0, 1.56, -0.14);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), darkMat);
  gun.position.set(0.2, 1.15, -0.3);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.26), darkMat);
  legs.position.y = 0.28;
  group.add(torso, head, visor, gun, legs);
  group.traverse((mesh) => {
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });
  scene.add(group);
  return { group, torso, head, gun };
}

export function createBot(scene, world, options) {
  const { isAlly, name, skill = 1, spawn } = options;
  const colorHex = isAlly ? PALETTE.ally : PALETTE.enemy;
  const body = buildBody(scene, isAlly ? PALETTE.surface : PALETTE.enemy, isAlly);
  const mover = createMover(world.colliders, spawn.x, spawn.z, spawn.yaw);
  const state = mover.state;
  state.alive = true; // the mover state doubles as the perception target view

  const bot = {
    name,
    isAlly,
    skill,
    health: HEALTH,
    alive: true,
    // brain
    mode: isAlly ? 'follow' : 'patrol',
    path: [],
    pathIndex: 0,
    waitUntil: 0,
    lastSeen: -100,
    lastSeenPos: new THREE.Vector3(),
    firstSeenAt: -100,
    reactAt: 0,
    strafeDir: 1,
    strafeUntil: 0,
    burstLeft: 0,
    burstTimer: 0,
    pauseUntil: 0,
    perceiveTimer: Math.random() * PERCEIVE_EVERY,
    investigatePos: null,
    defuseProgress: 0,
    coverSpot: null,
    flankUntil: 0,
    shotsFired: 0,
    kills: 0,
  };
  body.torso.userData.bot = bot;
  body.head.userData.bot = bot;

  const _wish = new THREE.Vector3();
  const _toTarget = new THREE.Vector3();

  function pickPatrolTarget(now) {
    const node = Math.floor(Math.random() * world.nodes.length);
    bot.path = world.findPath(state.position.x, state.position.z, world.nodes[node][0], world.nodes[node][1]);
    bot.pathIndex = 0;
    bot.waitUntil = now + 0.1;
  }

  function moveToward(tx, tz, dt, speedScale, keepYaw = false) {
    const dx = tx - state.position.x;
    const dz = tz - state.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) return true;
    const wishX = dx / dist;
    const wishZ = dz / dist;
    mover.step(dt, wishX, wishZ, false, false, speedScale);
    // Face where we walk unless we are engaging (then the gun stays on target).
    if (keepYaw) return false;
    const targetYaw = Math.atan2(-wishX, -wishZ);
    let dyaw = targetYaw - state.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    state.yaw += dyaw * Math.min(1, dt * 8);
    return false;
  }

  function followPath(dt, speedScale = 1, keepYaw = false) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = world.nodes[bot.path[bot.pathIndex]];
    if (moveToward(node[0], node[1], dt, speedScale, keepYaw)) bot.pathIndex += 1;
    return bot.pathIndex >= bot.path.length;
  }

  function canSee(pos, eyeHeight) {
    return world.hasLineOfSight(
      state.position.x, state.position.y + EYE, state.position.z,
      pos.x, pos.y + eyeHeight, pos.z,
    );
  }

  function perceive(now, ctx, dt) {
    bot.perceiveTimer -= dt;
    if (bot.perceiveTimer > 0) return;
    bot.perceiveTimer = PERCEIVE_EVERY;
    // Hostiles watch the player (and the squadmate); the squadmate watches hostiles.
    const targets = bot.isAlly ? ctx.enemies : [ctx.player, ctx.ally].filter((t) => t && t.alive);
    let best = null;
    let bestDist = Infinity;
    for (const target of targets) {
      if (!target || !target.alive) continue;
      const dx = target.position.x - state.position.x;
      const dy = (target.position.y + 1.2) - (state.position.y + EYE);
      const dz = target.position.z - state.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > SIGHT_RANGE || dist >= bestDist) continue;
      // Field of view, unless the target is close or just fired loudly.
      const fx = -Math.sin(state.yaw);
      const fz = -Math.cos(state.yaw);
      const dot = (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz));
      const heard = ctx.noise && ctx.noise.time > now - 0.4 && ctx.noise.pos.distanceToSquared(state.position) < HEAR_RANGE * HEAR_RANGE;
      if (dot < 0.2 && dist > 4 && !heard) continue;
      if (!canSee(target.position, 1.2)) continue;
      best = target;
      bestDist = dist;
    }
    if (best) {
      if (bot.lastSeen < now - 1.5) {
        bot.firstSeenAt = now;
        bot.reactAt = now + (0.35 + Math.random() * 0.25) / bot.skill;
      }
      bot.lastSeen = now;
      bot.lastSeenPos.copy(best.position);
      bot.target = best;
    } else {
      bot.target = null;
    }
  }

  function fireAt(now, ctx) {
    if (bot.burstLeft <= 0) {
      if (now < bot.pauseUntil) return;
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.burstTimer = 0;
      bot.pauseUntil = now + 0.55 + Math.random() * 0.6;
    }
    bot.burstTimer -= dt;
    if (bot.burstTimer > 0) return;
    bot.burstTimer = 0.115;
    bot.burstLeft -= 1;
    bot.shotsFired += 1;
    const target = bot.target;
    if (!target) return;
    const dx = target.position.x - state.position.x;
    const dy = (target.position.y + 1.15) - (state.position.y + EYE);
    const dz = target.position.z - state.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    // Hit chance falls with distance and target speed, rises with skill.
    let chance = 0.46 - dist * 0.013;
    chance *= bot.skill;
    const targetSpeed = target.velocity ? Math.hypot(target.velocity.x, target.velocity.z) : 0;
    if (targetSpeed > 3) chance *= 0.7;
    if (target.crouching) chance *= 0.8;
    chance = Math.max(0.05, Math.min(0.6, chance));
    ctx.botShoot(bot, target, chance, dist);
  }

  function step(dt, now, ctx) {
    if (!bot.alive) return;
    perceive(now, ctx, dt);
    const seenRecently = now - bot.lastSeen < 1.2;
    const reacted = now >= bot.reactAt;

    // Defuse: when the charge is planted, hostiles push the site.
    if (!bot.isAlly && ctx.planted) {
      const zone = world.plantZone;
      const distToSite = Math.hypot(zone.x - state.position.x, zone.z - state.position.z);
      if (distToSite < zone.radius && !seenRecently) {
        bot.defuseProgress += dt;
        state.yaw = 0;
        if (bot.defuseProgress >= 5) ctx.onDefused(bot);
        return;
      }
      bot.defuseProgress = 0;
      if (!seenRecently) {
        bot.path = world.findPath(state.position.x, state.position.z, zone.x, zone.z);
        bot.pathIndex = 0;
        followPath(dt, 1.15);
        return;
      }
    }

    // Hurt: fall back to the nearest cover spot and crouch-peek.
    if (bot.health < 35 && !bot.isAlly && !seenRecently) {
      if (!bot.coverSpot) {
        let bestSpot = null;
        let bestD = Infinity;
        for (const spot of world.cover) {
          const d = Math.hypot(spot.x - state.position.x, spot.z - state.position.z);
          if (d < bestD) { bestD = d; bestSpot = spot; }
        }
        bot.coverSpot = bestSpot;
      }
      const arrived = moveToward(bot.coverSpot.x, bot.coverSpot.z, dt, 1.1);
      if (arrived) {
        state.yaw = bot.coverSpot.yaw;
        mover.step(dt, 0, 0, true, false, 1);
      }
      return;
    }
    bot.coverSpot = null;

    if (bot.isAlly) {
      // VEX: stay near the player, engage what she sees.
      if (seenRecently && reacted && bot.target) {
        aimAtTarget(dt);
        fireAt(now, ctx);
        strafe(dt, now);
      } else {
        const px = ctx.player.position.x;
        const pz = ctx.player.position.z;
        const fx = -Math.sin(ctx.player.yaw);
        const fz = -Math.cos(ctx.player.yaw);
        // Stay off the player's shoulder, clamped inside the map so the
        // follow point never sits inside a wall.
        const tx = Math.max(-13.3, Math.min(13.3, px - fx * 2.2 + fz * 1.4));
        const tz = Math.max(-9.3, Math.min(10.3, pz - fz * 2.2 - fx * 1.4));
        const dist = Math.hypot(tx - state.position.x, tz - state.position.z);
        if (dist > 0.8) moveToward(tx, tz, dt, 1.05);
        else {
          state.yaw = ctx.player.yaw;
          mover.step(dt, 0, 0, false, false, 1);
        }
      }
      return;
    }

    // Hostile brain.
    if (seenRecently && reacted && bot.target) {
      bot.mode = 'engage';
      aimAtTarget(dt);
      fireAt(now, ctx);
      // Flank: if the target has not moved much, slip to a side node.
      if (now > bot.flankUntil) {
        bot.flankUntil = now + 6 + Math.random() * 4;
        const side = Math.random() < 0.5 ? -1 : 1;
        const tx = bot.target.position.x + side * 7;
        const tz = bot.target.position.z + 5;
        bot.path = world.findPath(state.position.x, state.position.z, tx, tz);
        bot.pathIndex = 0;
      }
      if (bot.pathIndex < bot.path.length) {
        // Flanking: walk the side route with the gun still on the target.
        followPath(dt, 0.9, true);
      } else {
        strafe(dt, now);
      }
      return;
    }
    if (now - bot.lastSeen < 6 && bot.lastSeen > 0) {
      // Investigate the last place the target was seen.
      bot.mode = 'investigate';
      const arrived = moveToward(bot.lastSeenPos.x, bot.lastSeenPos.z, dt, 1.15);
      if (arrived) bot.lastSeen = -100;
      return;
    }
    if (ctx.noise && now - ctx.noise.time < 1.5) {
      const d = ctx.noise.pos.distanceToSquared(state.position);
      if (d < HEAR_RANGE * HEAR_RANGE) {
        bot.mode = 'investigate';
        moveToward(ctx.noise.pos.x, ctx.noise.pos.z, dt, 1.1);
        return;
      }
    }
    // Patrol: walk the graph, pausing at each node.
    bot.mode = 'patrol';
    if (now < bot.waitUntil) {
      mover.step(dt, 0, 0, false, false, 1);
      return;
    }
    if (followPath(dt, 0.75)) {
      pickPatrolTarget(now);
      bot.waitUntil = now + 1.2 + Math.random() * 2.2;
    }
  }

  function aimAtTarget(dt) {
    if (!bot.target) return;
    _toTarget.set(
      bot.target.position.x - state.position.x,
      0,
      bot.target.position.z - state.position.z,
    );
    const targetYaw = Math.atan2(-_toTarget.x, -_toTarget.z);
    let dyaw = targetYaw - state.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    state.yaw += dyaw * Math.min(1, dt * 10);
    mover.step(dt, 0, 0, false, false, 1);
  }

  function strafe(dt, now) {
    if (now > bot.strafeUntil) {
      bot.strafeUntil = now + 0.7 + Math.random() * 0.8;
      bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    const fx = -Math.sin(state.yaw);
    const fz = -Math.cos(state.yaw);
    const wx = fz * bot.strafeDir;
    const wz = -fx * bot.strafeDir;
    mover.step(dt, wx * 0.55, wz * 0.55, false, false, 1);
  }

  function damage(amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    state.alive = false;
    bot.health = 0;
    body.group.rotation.x = -Math.PI / 2;
    body.group.position.y = 0.25;
    return true;
  }

  function reset(spawnPoint) {
    bot.health = HEALTH;
    bot.alive = true;
    state.alive = true;
    bot.mode = bot.isAlly ? 'follow' : 'patrol';
    bot.path = [];
    bot.pathIndex = 0;
    bot.lastSeen = -100;
    bot.target = null;
    bot.burstLeft = 0;
    bot.defuseProgress = 0;
    bot.coverSpot = null;
    state.position.set(spawnPoint.x, 0, spawnPoint.z);
    state.velocity.set(0, 0, 0);
    state.yaw = spawnPoint.yaw;
    state.pitch = 0;
    state.crouching = false;
    body.group.rotation.set(0, 0, 0);
    body.group.position.y = 0;
    pickPatrolTarget(0);
  }

  function syncVisual() {
    body.group.position.x = state.position.x;
    body.group.position.z = state.position.z;
    if (bot.alive) {
      body.group.position.y = state.position.y;
      body.group.rotation.y = state.yaw;
      const bob = Math.hypot(state.velocity.x, state.velocity.z) > 0.5
        ? Math.sin(performance.now() * 0.012) * 0.03 : 0;
      body.group.position.y = state.position.y + bob;
    }
  }

  function eyePos(out) {
    out.set(state.position.x, state.position.y + EYE, state.position.z);
    return out;
  }

  // The combat module talks to the inner bot record, so it carries the
  // handles the rest of the game needs.
  bot.state = state;
  bot.eyePos = eyePos;
  bot.damage = damage;

  return {
    bot,
    state,
    body,
    step,
    damage,
    reset,
    syncVisual,
    eyePos,
    hitMeshes: [body.torso, body.head],
  };
}
