// The arsenal: three guns and a frag grenade. Each gun owns its numbers —
// damage, rate, magazine, spread, recoil — and its view model; main.js owns
// the ray and the damage. Aim-down-sights (right mouse) narrows the spread
// and slows the player, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  smg: {
    id: 'smg', name: 'VK-9 SMG', price: 0,
    damage: 24, headMult: 3, pellets: 1, fireGap: 0.085, auto: true,
    magSize: 32, reserve: 96, reloadTime: 1.6,
    spreadStill: 0.0032, spreadMoving: 0.03, spreadAir: 0.05,
    recoilPitch: 0.008, recoilYaw: 0.003, kick: 0.045,
    barrel: 0.3, bodyColor: 'hairline',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', price: 700,
    damage: 34, headMult: 3, pellets: 1, fireGap: 0.11, auto: true,
    magSize: 25, reserve: 75, reloadTime: 2.1,
    spreadStill: 0.0016, spreadMoving: 0.024, spreadAir: 0.042,
    recoilPitch: 0.013, recoilYaw: 0.004, kick: 0.06,
    barrel: 0.52, bodyColor: 'ink',
  },
  shotgun: {
    id: 'shotgun', name: 'M590 Breacher', price: 500,
    damage: 11, headMult: 2, pellets: 8, fireGap: 0.85, auto: false,
    magSize: 6, reserve: 24, reloadTime: 2.6,
    spreadStill: 0.05, spreadMoving: 0.06, spreadAir: 0.07,
    recoilPitch: 0.03, recoilYaw: 0.008, kick: 0.12,
    barrel: 0.42, bodyColor: 'accent',
  },
};
export const GRENADE_PRICE = 200;
export const ARMOR_PRICE = 300;
export const WEAPON_ORDER = ['smg', 'rifle', 'shotgun'];

export function createWeaponSet(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.35 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const amber = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = new THREE.Group();
    const bodyMat = def.bodyColor === 'ink' ? light : def.bodyColor === 'accent' ? amber : grip;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.4), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), dark);
    barrel.position.set(0, 0.03, -0.2 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), dark);
    sight.position.set(0, 0.08, -0.05);
    model.add(receiver, barrel, stock, sight);
    model.position.set(0.22, -0.21, -0.45);
    model.scale.setScalar(0.85);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.22, -0.16, -0.85);
  flash.rotation.z = 0.6;
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.22, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'smg',
    owned: { smg: true, rifle: false, shotgun: false },
    // Ammo is kept per weapon, so switching guns never refills one.
    ammo: {
      smg: { mag: WEAPONS.smg.magSize, reserve: WEAPONS.smg.reserve },
      rifle: { mag: WEAPONS.rifle.magSize, reserve: WEAPONS.rifle.reserve },
      shotgun: { mag: WEAPONS.shotgun.magSize, reserve: WEAPONS.shotgun.reserve },
    },
    mag: WEAPONS.smg.magSize,
    reserve: WEAPONS.smg.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    ads: 0, // 0 hip, 1 fully aimed
    grenades: 0,
    armor: 0,
  };
  models.smg.visible = true;

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt, aiming) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.ads += ((aiming ? 1 : 0) - state.ads) * Math.min(1, dt * 10);
    const model = models[state.current];
    const adsX = 0.22 - 0.22 * state.ads;
    const adsY = -0.21 + 0.06 * state.ads;
    model.position.set(adsX, adsY, -0.45 + state.kick);
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = 0.6 + state.flash * 4;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def().magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    def,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const d = def();
      state.cooldown = d.fireGap;
      state.flash = 0.06;
      state.kick = d.kick;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.magSize || state.reserve === 0) return;
      state.reloadLeft = d.reloadTime;
    },
    spread(speed, airborne) {
      const d = def();
      const base = airborne ? d.spreadAir : d.spreadStill + Math.min(1, speed / 5.4) * d.spreadMoving;
      return base * (1 - 0.55 * state.ads);
    },
    recoil() {
      const d = def();
      return { pitch: d.recoilPitch, yaw: (Math.random() * 2 - 1) * d.recoilYaw };
    },
    switchTo(id) {
      if (!state.owned[id] || id === state.current || state.reloadLeft > 0) return false;
      state.ammo[state.current] = { mag: state.mag, reserve: state.reserve };
      models[state.current].visible = false;
      state.current = id;
      state.mag = state.ammo[id].mag;
      state.reserve = state.ammo[id].reserve;
      state.cooldown = 0.25;
      models[id].visible = true;
      return true;
    },
    buy(id, money) {
      const d = WEAPONS[id];
      if (!d || state.owned[id] || money < d.price) return money;
      state.owned[id] = true;
      return money - d.price;
    },
    buyGrenade(money) {
      if (state.grenades >= 2 || money < GRENADE_PRICE) return money;
      state.grenades += 1;
      return money - GRENADE_PRICE;
    },
    buyArmor(money) {
      if (state.armor >= 50 || money < ARMOR_PRICE) return money;
      state.armor = 50;
      return money - ARMOR_PRICE;
    },
    refillRound() {
      // Between rounds: top up every owned gun's reserve, keep owned guns.
      for (const id of Object.keys(state.owned)) {
        if (!state.owned[id]) continue;
        const d = WEAPONS[id];
        state.ammo[id] = { mag: d.magSize, reserve: d.reserve };
      }
      state.mag = state.ammo[state.current].mag;
      state.reserve = state.ammo[state.current].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    resetMatch() {
      state.owned = { smg: true, rifle: false, shotgun: false };
      state.ammo = {
        smg: { mag: WEAPONS.smg.magSize, reserve: WEAPONS.smg.reserve },
        rifle: { mag: WEAPONS.rifle.magSize, reserve: WEAPONS.rifle.reserve },
        shotgun: { mag: WEAPONS.shotgun.magSize, reserve: WEAPONS.shotgun.reserve },
      };
      state.grenades = 0;
      state.armor = 0;
      models[state.current].visible = false;
      state.current = 'smg';
      models.smg.visible = true;
      state.mag = WEAPONS.smg.magSize;
      state.reserve = WEAPONS.smg.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
