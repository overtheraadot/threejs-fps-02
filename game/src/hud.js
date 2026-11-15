// The DOM HUD: crosshair, hit marker, health, ammo, money, round score,
// timer, objective, minimap, kill feed, buy menu and the overlay panels.
// It never touches the simulation; main.js pushes numbers in and reads the
// buy and play callbacks out.
import { PALETTE } from './palette.js';

const COPY = {
  start: {
    title: 'BREACHLINE',
    copy: 'Annex 9. Five rounds, first to three. Breach the core hall, clear the hostiles, or plant the charge on the DATA CORE and hold it till it blows.',
    action: 'Click to breach',
  },
  paused: { title: 'BREACHLINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  buy: { title: 'Buy phase', copy: 'Spend the round\'s pay before the next breach.', action: 'Deploy' },
  roundWon: { title: 'Round won', copy: '', action: 'Next round' },
  roundLost: { title: 'Round lost', copy: '', action: 'Next round' },
  matchWon: { title: 'Annex cleared', copy: '', action: 'Play again' },
  matchLost: { title: 'Annex held', copy: '', action: 'Play again' },
};

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armorRow = $('armor-row');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const roundsValue = $('rounds-value');
  const timerValue = $('timer-value');
  const objectiveText = $('objective-text');
  const hitmarker = $('hitmarker');
  const damageVignette = $('damage-vignette');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const crosshair = $('crosshair');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');
  const buyPanel = $('buy-panel');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const grenadePips = $('grenade-pips');
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;
  let lastAmmo = '';
  let buyHandler = null;

  // Minimap: the map is 28.6 x 21.6 m; scale it into the 168 x 128 canvas.
  const MAP_W = 28.6;
  const MAP_H = 21.6;
  const SCALE = 168 / MAP_W;
  function mapX(x) { return (x + MAP_W / 2) * SCALE; }
  function mapZ(z) { return (z + 10.8) * (128 / MAP_H); }

  function drawMinimap(player, ally, enemies, planted) {
    const ctx = mapCtx;
    ctx.clearRect(0, 0, 168, 128);
    ctx.fillStyle = 'rgba(14,17,22,0.82)';
    ctx.fillRect(0, 0, 168, 128);
    ctx.fillStyle = '#2e3440';
    for (const rect of world.minimapRects) {
      ctx.fillRect(mapX(rect.x0), mapZ(rect.z0), (rect.x1 - rect.x0) * SCALE, (rect.z1 - rect.z0) * (128 / MAP_H));
    }
    // Plant zone.
    ctx.strokeStyle = planted ? '#ff4d3d' : PALETTE.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mapX(0), mapZ(-8.2), 2.4 * SCALE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = planted ? '#ff4d3d' : PALETTE.accent;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('◆', mapX(0), mapZ(-9.3) + 4);
    // Spotted enemies (lastSeen is seconds since the enemy was last seen).
    for (const enemy of enemies) {
      if (!enemy.alive || enemy.lastSeen > 2.5) continue;
      ctx.fillStyle = PALETTE.enemy;
      ctx.beginPath();
      ctx.arc(mapX(enemy.x), mapZ(enemy.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Squadmate.
    if (ally && ally.alive) {
      ctx.fillStyle = PALETTE.ally;
      ctx.beginPath();
      ctx.arc(mapX(ally.x), mapZ(ally.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    if (player) {
      ctx.save();
      ctx.translate(mapX(player.x), mapZ(player.z));
      ctx.rotate(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI / 2);
      ctx.fillStyle = '#ece7db';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  return {
    setHealth(health, max) {
      const pct = Math.max(0, (health / max) * 100);
      healthFill.style.width = `${pct}%`;
      healthFill.style.background = pct > 50 ? PALETTE.ally : pct > 25 ? PALETTE.accent : PALETTE.enemy;
      healthValue.textContent = String(Math.ceil(Math.max(0, health)));
    },
    setArmor(armor) {
      armorRow.style.display = armor > 0 ? 'flex' : 'none';
      armorValue.textContent = String(Math.ceil(armor));
    },
    setAmmo(mag, reserve, name) {
      const key = `${mag}|${reserve}|${name}`;
      if (key === lastAmmo) return;
      lastAmmo = key;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setGrenades(count) {
      grenadePips.textContent = '●'.repeat(count) + '○'.repeat(Math.max(0, 2 - count));
    },
    setMoney(money) {
      moneyValue.textContent = `$${money}`;
    },
    setRounds(won, lost, round) {
      roundsValue.textContent = `R${round} · ${won}–${lost}`;
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timerValue.textContent = text;
      timerValue.classList.toggle('low', seconds <= 15);
    },
    setObjective(text) {
      objectiveText.textContent = text;
    },
    setCrosshairGap(spreadPx) {
      crosshair.style.setProperty('--gap', `${spreadPx}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageVignette.classList.remove('on'), 220);
    },
    killFeed(text, good) {
      const line = document.createElement('div');
      line.className = good ? 'feed-good' : 'feed-bad';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    banner(text, holdMs = 2200) {
      banner.textContent = text;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    setPlant(progress, label) {
      if (progress == null) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    drawMinimap,
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail ?? text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    overlayHidden() {
      return overlay.hidden;
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy(money, owned, onBuy) {
      buyHandler = onBuy;
      buyPanel.hidden = false;
      const items = [
        { id: 'rifle', label: 'AR-77 Longshot — rifle', price: 700, owned: owned.rifle },
        { id: 'shotgun', label: 'M590 Breacher — shotgun', price: 500, owned: owned.shotgun },
        { id: 'grenade', label: 'Frag grenade', price: 200, owned: false },
        { id: 'armor', label: 'Kevlar vest (+50 armor)', price: 300, owned: false },
      ];
      const list = $('buy-list');
      list.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-item';
        row.disabled = item.owned || money < item.price;
        row.textContent = item.owned ? `${item.label} — OWNED` : `${item.label} — $${item.price}`;
        row.addEventListener('click', () => {
          if (buyHandler) buyHandler(item.id);
        });
        list.appendChild(row);
      }
      $('buy-money').textContent = `$${money}`;
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    setBuyMoney(money) {
      const el = $('buy-money');
      if (el) el.textContent = `$${money}`;
    },
  };
}
