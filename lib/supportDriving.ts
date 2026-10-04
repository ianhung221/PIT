import type { RigidBody } from "@dimforge/rapier3d-compat";

interface DrivingFrame { forwardX: number; forwardZ: number; forwardSpeed: number; lateralSpeed: number; rightX: number; rightZ: number }
// The standalone test engine and React wrapper may resolve different Rapier
// versions. Require only the common public methods used by this controller.
type DrivingBody = Pick<RigidBody, "angvel" | "setAngvel" | "mass" | "applyImpulse" | "linvel" | "setLinvel">;
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

// Shared by the simulation and physical manoeuvre regression tests.
export function driveSupport(body: DrivingBody, yawError: number, targetSpeed: number, maxSpeed: number, dt: number, grip: number, frame: DrivingFrame) {
  const angularTarget = clamp(yawError * 2.3, -.68, .68);
  const angular = body.angvel();
  body.setAngvel({ x: 0, y: angular.y + (angularTarget - angular.y) * Math.min(1, dt * 3.2 * grip), z: 0 }, true);
  const acceleration = clamp((targetSpeed - frame.forwardSpeed) * 2 + Math.max(0, frame.forwardSpeed) * .1, -14 * grip, 9 * grip);
  const mass = body.mass();
  body.applyImpulse({ x: frame.forwardX * mass * acceleration * dt, y: 0, z: frame.forwardZ * mass * acceleration * dt }, true);
  const lateral = -frame.lateralSpeed * mass * Math.min(1, grip * 7 * dt);
  body.applyImpulse({ x: frame.rightX * lateral, y: 0, z: frame.rightZ * lateral }, true);
  const velocity = body.linvel();
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed > maxSpeed) body.setLinvel({ x: velocity.x * maxSpeed / speed, y: velocity.y, z: velocity.z * maxSpeed / speed }, true);
}
