// BREACHLINE — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. Match flow: menu -> buy phase -> round ->
// round end -> ... first to 3 rounds takes Annex 9. Win a round by clearing
// every hostile or by planting the charge on the DATA CORE and holding it
// till it blows; lose it if both friendlies fall, the timer runs out, or the
// hostiles defuse the charge.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponSet, WEAPONS, WEAPON_ORDER, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';
import { createBot } from './bots.js';
import { createCombat } from './combat.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 90;
const BUY_TIME = 20;
const PLANT_TIME = 3;
const FUSE_TIME = 12;
const ROUNDS_TO_WIN = 3;
const MAX_ROUNDS = 5;
const PLAYER_HEALTH = 100;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 20, 55);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud(world);
const player = createPlayer(world.colliders, world.playerSpawn);
const weapons = createWeaponSet(camera);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// The squad: VEX (ally) plus four hostiles.
const ally = createBot(scene, world, { isAlly: true, name: 'VEX', skill: 1.15, spawn: world.allySpawn });
const enemies = world.enemySpawns.map((spawn, i) => createBot(scene, world, {
  isAlly: false,
  name: `RAIDER-${i + 1}`,
  skill: 0.9 + i * 0.06,
  spawn,
}));
const botMeshes = [];
for (const bot of [ally, ...enemies]) botMeshes.push(...bot.hitMeshes);

// --- match state, kept in one place ---
const match = {
  phase: 'menu', // menu | buy | round | roundEnd | matchEnd
  round: 1,
  roundsWon: 0,
  roundsLost: 0,
  money: 800,
  timer: ROUND_TIME,
  buyTimer: BUY_TIME,
  planted: false,
  fuse: 0,
  plantProgress: 0,
  kills: 0,
  deaths: 0,
};
const playerState = player.state;
playerState.alive = true;
playerState.health = PLAYER_HEALTH;
playerState.applyDamage = applyPlayerDamage;
ally.state.applyDamage = (amount, kind, from) => applyBotDamage(ally, amount, kind, from);
for (const enemy of enemies) enemy.state.applyDamage = (amount, kind, from) => applyBotDamage(enemy, amount, kind, from);

const noise = { time: -100, pos: new THREE.Vector3() };
const direction = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
let elapsed = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let buyOpen = false;

const combat = createCombat(scene, world, {
  targets: () => [playerState, ally.state, ...enemies.map((e) => e.state)],
  damageTarget: (target, amount, kind, from) => target.applyDamage(amount, kind, from),
  onExplosion: (pos) => {
    noise.time = elapsed;
    noise.pos.copy(pos);
  },
});

function applyPlayerDamage(amount, kind, from) {
  if (!playerState.alive || match.phase !== 'round') return;
  // Kevlar absorbs 60% of the hit until it is gone.
  let remaining = amount;
  const armor = weapons.state.armor;
  if (armor > 0) {
    const absorbed = Math.min(armor, Math.round(amount * 0.6));
    weapons.state.armor -= absorbed;
    remaining -= absorbed;
  }
  playerState.health -= remaining;
  hud.damageFlash();
  hud.setArmor(weapons.state.armor);
  if (playerState.health <= 0) {
    playerState.health = 0;
    playerState.alive = false;
    match.deaths += 1;
    hud.killFeed(`${from ? from.name : 'RAIDER'} ▸ YOU`, false);
    checkRoundEnd();
  }
}

function applyBotDamage(bot, amount, kind, from) {
  if (!bot.bot.alive || match.phase !== 'round') return;
  const killed = bot.damage(amount);
  if (!killed) return;
  if (bot.bot.isAlly) {
    hud.killFeed(`${from ? from.name : 'RAIDER'} ▸ VEX`, false);
    checkRoundEnd();
    return;
  }
  match.kills += 1;
  match.money += 100;
  const killer = kind === 'grenade' ? 'YOU (frag)' : from && from.isAlly ? 'VEX' : 'YOU';
  hud.killFeed(`${killer} ▸ ${bot.bot.name}`, true);
  checkRoundEnd();
}

function checkRoundEnd() {
  if (match.phase !== 'round') return;
  const enemiesAlive = enemies.some((e) => e.bot.alive);
  if (!enemiesAlive) { endRound(true, 'All hostiles down.'); return; }
  if (!playerState.alive && !ally.bot.alive) endRound(false, 'Squad wiped.');
}

function endRound(won, reason) {
  if (match.phase !== 'round') return;
  match.phase = 'roundEnd';
  match.planted = false;
  match.plantProgress = 0;
  hud.setPlant(null);
  if (won) {
    match.roundsWon += 1;
    match.money += 300;
  } else {
    match.roundsLost += 1;
    match.money += 150;
  }
  hud.setMoney(match.money);
  hud.setRounds(match.roundsWon, match.roundsLost, match.round);
  if (document.pointerLockElement) document.exitPointerLock();
  if (match.roundsWon >= ROUNDS_TO_WIN || match.roundsLost >= ROUNDS_TO_WIN || match.round >= MAX_ROUNDS) {
    match.phase = 'matchEnd';
    const matchWon = match.roundsWon > match.roundsLost;
    hud.showOverlay(matchWon ? 'matchWon' : 'matchLost',
      `${reason} Final: ${match.roundsWon}–${match.roundsLost}. ${match.kills} eliminations. ${matchWon ? 'Annex 9 is yours.' : 'The hostiles keep the annex.'}`);
  } else {
    hud.showOverlay(won ? 'roundWon' : 'roundLost',
      `${reason} Score ${match.roundsWon}–${match.roundsLost}. Pay +$${won ? 300 : 150}.`);
  }
}

function startMatch() {
  match.round = 1;
  match.roundsWon = 0;
  match.roundsLost = 0;
  match.money = 800;
  match.kills = 0;
  match.deaths = 0;
  weapons.resetMatch();
  startBuyPhase();
}

function startBuyPhase() {
  match.phase = 'buy';
  match.buyTimer = BUY_TIME;
  match.planted = false;
  match.plantProgress = 0;
  hud.setPlant(null);
  player.reset();
  playerState.alive = true;
  playerState.health = PLAYER_HEALTH;
  ally.reset(world.allySpawn);
  for (let i = 0; i < enemies.length; i += 1) enemies[i].reset(world.enemySpawns[i]);
  combat.reset();
  weapons.refillRound();
  hud.setHealth(PLAYER_HEALTH, PLAYER_HEALTH);
  hud.setArmor(weapons.state.armor);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.setGrenades(weapons.state.grenades);
  hud.setMoney(match.money);
  hud.setRounds(match.roundsWon, match.roundsLost, match.round);
  hud.setTimer(ROUND_TIME);
  hud.setObjective('Clear the hostiles or plant the charge');
  hud.showBuy(match.money, weapons.state.owned, onBuy);
  buyOpen = true;
  hud.hideOverlay();
  hud.banner('BUY PHASE — kit up, then Deploy', 3000);
}

function startRound() {
  match.phase = 'round';
  match.timer = ROUND_TIME;
  match.planted = false;
  match.fuse = 0;
  match.plantProgress = 0;
  hud.hideBuy();
  buyOpen = false;
  hud.hideOverlay();
  hud.banner(`ROUND ${match.round} — BREACH`, 2400);
  hud.setObjective('Clear the hostiles or plant the charge');
  input.requestLock();
}

function onBuy(id) {
  if (match.phase !== 'buy') return;
  const before = match.money;
  if (id === 'grenade') match.money = weapons.buyGrenade(match.money);
  else if (id === 'armor') match.money = weapons.buyArmor(match.money);
  else match.money = weapons.buy(id, match.money);
  if (match.money !== before) {
    hud.setMoney(match.money);
    hud.setBuyMoney(match.money);
    hud.setGrenades(weapons.state.grenades);
    hud.setArmor(weapons.state.armor);
    hud.showBuy(match.money, weapons.state.owned, onBuy);
    if (id === 'rifle' || id === 'shotgun') weapons.switchTo(id);
    hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    if (match.phase === 'round') hud.hideOverlay();
  } else if (match.phase === 'round') {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (match.phase === 'menu') startMatch();
  else if (match.phase === 'buy') startRound();
  else if (match.phase === 'roundEnd') { match.round += 1; startBuyPhase(); }
  else if (match.phase === 'matchEnd') startMatch();
  else if (match.phase === 'round') input.requestLock();
});
document.getElementById('deploy').addEventListener('click', () => {
  if (match.phase === 'buy') startRound();
});
renderer.domElement.addEventListener('click', () => {
  if (!shot && match.phase === 'round' && !input.state.locked) input.requestLock();
});

function syncCamera() {
  camera.position.set(playerState.position.x, playerState.position.y + playerState.eye, playerState.position.z);
  camera.rotation.set(playerState.pitch, playerState.yaw, 0, 'YXZ');
  const targetFov = 74 - 19 * weapons.state.ads;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
}

function aimAt(point) {
  const dx = point.x - playerState.position.x;
  const dy = point.y - (playerState.position.y + playerState.eye);
  const dz = point.z - playerState.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  playerState.yaw = Math.atan2(-dx, -dz);
  playerState.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shootPlayer(spread) {
  if (!weapons.takeRound()) return false;
  const def = weapons.def();
  camera.getWorldDirection(direction);
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    const dir = direction.clone();
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    _eye.copy(camera.position);
    const result = combat.shootPlayer(_eye, dir, botMeshes);
    const muzzle = _muzzle.copy(camera.position).addScaledVector(direction, 0.5);
    muzzle.y -= 0.12;
    if (result.kind === 'bot') {
      const damage = def.damage * (result.part === 'head' ? def.headMult : 1);
      const killed = result.bot.damage(damage);
      combat.addTracer(muzzle, result.point, parseInt(PALETTE.ink.slice(1), 16));
      hud.hitMarker(killed, shot ? 4000 : 120);
      if (killed) {
        match.kills += 1;
        match.money += 100;
        hud.killFeed(`YOU ▸ ${result.bot.name}${result.part === 'head' ? ' (headshot)' : ''}`, true);
        hud.setMoney(match.money);
        checkRoundEnd();
      }
    } else {
      combat.addTracer(muzzle, result.point, parseInt(PALETTE.ink.slice(1), 16));
    }
  }
  noise.time = elapsed;
  noise.pos.copy(playerState.position);
  weapons.pullTrigger();
  const recoil = weapons.recoil();
  player.addRecoil(recoil.pitch, recoil.yaw);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, def.name);
  return true;
}

function throwGrenade() {
  if (weapons.state.grenades <= 0 || match.phase !== 'round') return;
  camera.getWorldDirection(direction);
  _eye.copy(camera.position).addScaledVector(direction, 0.4);
  if (combat.throwGrenade(_eye, direction)) {
    weapons.state.grenades -= 1;
    hud.setGrenades(weapons.state.grenades);
  }
}

function botContext() {
  return {
    player: playerState,
    ally: ally.state,
    enemies: enemies.map((e) => e.state),
    noise,
    planted: match.planted,
    onDefused: () => endRound(false, 'The charge was defused.'),
    botShoot: (bot, target, chance, dist) => combat.botShoot(bot, target, chance, dist),
  };
}

function step(dt) {
  elapsed += dt;
  if (match.phase === 'buy') {
    match.buyTimer -= dt;
    hud.setTimer(match.buyTimer);
    if (match.buyTimer <= 0) startRound();
  }
  if (match.phase === 'round') {
    match.timer -= dt;
    if (!match.planted && match.timer <= 0) {
      match.timer = 0;
      endRound(false, 'Time expired — the hostiles hold the annex.');
    }
    if (match.planted) {
      match.fuse -= dt;
      hud.setObjective(`CHARGE LIVE — detonation in ${Math.max(0, Math.ceil(match.fuse))}s`);
      hud.setPlant(1 - match.fuse / FUSE_TIME, 'CHARGE FUSE');
      if (match.fuse <= 0) endRound(true, 'The DATA CORE is gone.');
    } else {
      // Planting: hold E inside the zone.
      const zone = world.plantZone;
      const inZone = Math.hypot(zone.x - playerState.position.x, zone.z - playerState.position.z) < zone.radius;
      if (inZone && playerState.alive && input.state.keys.has('KeyE')) {
        match.plantProgress += dt / PLANT_TIME;
        hud.setPlant(Math.min(1, match.plantProgress), 'PLANTING CHARGE — HOLD E');
        if (match.plantProgress >= 1) {
          match.planted = true;
          match.fuse = FUSE_TIME;
          match.money += 150;
          hud.setMoney(match.money);
          hud.banner('CHARGE PLANTED — HOLD THE SITE', 2600);
          hud.setPlant(null);
        }
      } else {
        match.plantProgress = Math.max(0, match.plantProgress - dt * 2);
        hud.setPlant(match.plantProgress > 0 ? match.plantProgress : null, 'PLANTING CHARGE — HOLD E');
      }
    }
    hud.setTimer(match.planted ? match.fuse : match.timer);
  }

  // Player.
  const look = input.takeLook();
  player.look(look.x, look.y);
  const presses = input.takePresses();
  const aiming = input.state.aiming && match.phase === 'round';
  if (playerState.alive && match.phase === 'round') {
    player.step(dt, input.state.keys, aiming);
    if (input.state.firing && weapons.ready()) {
      shootPlayer(weapons.spread(player.groundSpeed(), !playerState.onGround));
    }
    if (input.state.keys.has('KeyR')) weapons.reload();
    for (const code of presses) {
      if (code === 'Digit1') weapons.switchTo(WEAPON_ORDER[0]);
      else if (code === 'Digit2') weapons.switchTo(WEAPON_ORDER[1]);
      else if (code === 'Digit3') weapons.switchTo(WEAPON_ORDER[2]);
      else if (code === 'KeyG') throwGrenade();
    }
  }
  weapons.step(dt, aiming);

  // Bots.
  const ctx = botContext();
  if (match.phase === 'round') {
    ally.step(dt, elapsed, ctx);
    for (const enemy of enemies) enemy.step(dt, elapsed, ctx);
  }
  combat.step(dt);
  ally.syncVisual();
  for (const enemy of enemies) enemy.syncVisual();

  // HUD.
  hud.setHealth(playerState.health, PLAYER_HEALTH);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.setCrosshairGap(4 + weapons.spread(player.groundSpeed(), !playerState.onGround) * 900);
  // If the round is live but the pointer is not locked (auto-deploy after the
  // buy timer, or a failed lock request), invite the player to click in.
  if (!shot && match.phase === 'round' && !input.state.locked && hud.overlayHidden()) {
    hud.showOverlay('paused');
  }
  hud.drawMinimap(
    { x: playerState.position.x, z: playerState.position.z, yaw: playerState.yaw },
    { x: ally.state.position.x, z: ally.state.position.z, alive: ally.bot.alive },
    enemies.map((e) => ({ x: e.state.position.x, z: e.state.position.z, alive: e.bot.alive, lastSeen: elapsed - e.bot.lastSeen })),
    match.planted,
  );
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  match.phase = 'round';
  match.timer = ROUND_TIME;
  playerState.alive = true;
  playerState.health = PLAYER_HEALTH;
  ally.reset(world.allySpawn);
  for (let i = 0; i < enemies.length; i += 1) enemies[i].reset(world.enemySpawns[i]);
  if (name === 'start') {
    playerState.position.set(0, 0, -3.5);
    playerState.yaw = 0;
    playerState.pitch = 0;
    settle(20);
    hud.showOverlay('start');
  } else if (name === 'play') {
    playerState.position.set(0, 0, 1.5);
    playerState.yaw = 0;
    playerState.pitch = 0;
    settle(20);
    // Stage two hostiles in the doorway ahead and drop one.
    const first = enemies[2];
    first.state.position.set(-1.2, 0, -4.5);
    first.state.yaw = Math.PI;
    const second = enemies[3];
    second.state.position.set(1.4, 0, -4.5);
    second.state.yaw = Math.PI;
    settle(4);
    aimAt(new THREE.Vector3(-1.2, 1.2, -4.5));
    shootPlayer(0);
    settle(5); // let the muzzle flash fade; the tracer is still visible
    hud.setObjective('Clear the hostiles or plant the charge');
  } else if (name === 'end') {
    playerState.position.set(0, 0, -5.5);
    playerState.yaw = 0;
    playerState.pitch = 0;
    for (const enemy of enemies) enemy.damage(999);
    match.roundsWon = 1;
    match.kills = 4;
    settle(30);
    hud.showOverlay('roundWon', 'All hostiles down. Score 1–0. Pay +$300.');
  }
  hud.setHealth(playerState.health, PLAYER_HEALTH);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.setMoney(match.money);
  hud.setRounds(match.roundsWon, match.roundsLost, match.round);
  hud.setTimer(match.timer);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(PLAYER_HEALTH, PLAYER_HEALTH);
hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
hud.setMoney(match.money);
hud.setRounds(0, 0, 1);
// Debug handle for play-testing: read-only match state for automated checks.
window.__breachline = { match, player: playerState, ally: ally.bot, enemies: enemies.map((e) => e.bot) };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
