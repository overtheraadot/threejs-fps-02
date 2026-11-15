// Player movement: acceleration, friction, gravity, crouch and jump, resolved
// as a box against the world's colliders one axis at a time, so a wall never
// swallows the player. The same box test drives the bots, so the map treats
// every combatant the same way.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const ADS_SPEED = 3.2;
const GROUND_ACCEL = 44;
const AIR_ACCEL = 10;
const FRICTION = 9.5;
const GRAVITY = 21;
const JUMP_SPEED = 6.4;

export function createMover(colliders, startX, startZ, startYaw) {
  const mover = {
    position: new THREE.Vector3(startX, 0, startZ),
    velocity: new THREE.Vector3(),
    yaw: startYaw,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing
  // on the floor is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0021) {
    mover.yaw -= dx * sensitivity;
    mover.pitch = Math.max(-1.45, Math.min(1.45, mover.pitch - dy * sensitivity));
  }

  function addRecoil(pitchKick, yawKick) {
    mover.pitch = Math.min(1.45, mover.pitch + pitchKick);
    mover.yaw += yawKick;
  }

  // wishX/wishZ are already in world space (-1..1 each); speed caps the wish.
  function step(dt, wishX, wishZ, wantCrouch, wantJump, speedScale = 1) {
    if (wantCrouch && !mover.crouching) {
      mover.crouching = true;
      mover.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && mover.crouching && !overlaps(mover.position.x, mover.position.y, mover.position.z, STAND_HEIGHT, 0.02)) {
      mover.crouching = false;
      mover.height = STAND_HEIGHT;
    }
    const eyeTarget = mover.crouching ? CROUCH_EYE : STAND_EYE;
    mover.eye += (eyeTarget - mover.eye) * Math.min(1, dt * 12);

    const speed = (mover.crouching ? CROUCH_SPEED : WALK_SPEED) * speedScale;
    const blend = Math.min(1, ((mover.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / Math.max(0.01, speed));
    mover.velocity.x += (wishX * speed - mover.velocity.x) * blend;
    mover.velocity.z += (wishZ * speed - mover.velocity.z) * blend;
    if (mover.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      mover.velocity.x *= damp;
      mover.velocity.z *= damp;
    }

    if (wantJump && mover.onGround) {
      mover.velocity.y = JUMP_SPEED;
      mover.onGround = false;
    }
    mover.velocity.y -= GRAVITY * dt;

    const nextX = mover.position.x + mover.velocity.x * dt;
    if (!overlaps(nextX, mover.position.y, mover.position.z, mover.height, 0.04)) mover.position.x = nextX;
    else mover.velocity.x = 0;
    const nextZ = mover.position.z + mover.velocity.z * dt;
    if (!overlaps(mover.position.x, mover.position.y, nextZ, mover.height, 0.04)) mover.position.z = nextZ;
    else mover.velocity.z = 0;

    mover.position.y += mover.velocity.y * dt;
    mover.onGround = false;
    const hit = overlaps(mover.position.x, mover.position.y, mover.position.z, mover.height, 0);
    if (hit && mover.velocity.y <= 0) {
      mover.position.y = hit.max.y;
      mover.velocity.y = 0;
      mover.onGround = true;
    } else if (hit) {
      mover.position.y = hit.min.y - mover.height;
      mover.velocity.y = 0;
    }
    if (mover.position.y < 0) {
      mover.position.y = 0;
      mover.velocity.y = 0;
      mover.onGround = true;
    }
    mover.velocity.y = Math.max(-30, mover.velocity.y);
  }

  return {
    state: mover,
    step,
    look,
    addRecoil,
    overlaps,
    groundSpeed() {
      return Math.hypot(mover.velocity.x, mover.velocity.z);
    },
    adsSpeed: ADS_SPEED,
  };
}

// The player wraps a mover with keyboard wish directions.
export function createPlayer(colliders, spawn) {
  const mover = createMover(colliders, spawn.x, spawn.z, spawn.yaw);
  const body = mover.state;
  const wish = new THREE.Vector3();

  return {
    state: body,
    look: mover.look,
    addRecoil: mover.addRecoil,
    groundSpeed: mover.groundSpeed,
    step(dt, keys, aiming) {
      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      wish.set(0, 0, 0);
      if (forward || strafe) {
        const sin = Math.sin(body.yaw);
        const cos = Math.cos(body.yaw);
        wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
      }
      mover.step(
        dt,
        wish.x,
        wish.z,
        keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
        keys.has('Space'),
        aiming ? mover.adsSpeed / WALK_SPEED : 1,
      );
    },
    reset() {
      body.position.set(spawn.x, 0, spawn.z);
      body.velocity.set(0, 0, 0);
      body.yaw = spawn.yaw;
      body.pitch = 0;
      body.crouching = false;
      body.height = STAND_HEIGHT;
      body.eye = STAND_EYE;
    },
  };
}
