import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePitContact } from "../lib/gameRules.ts";

test("accepts a rear-quarter contact with enough closing speed", () => {
  const result = evaluatePitContact({ dx: 1.1, dz: 0.2, relativeSpeed: 6, grip: 1, cooldown: 0 });
  assert.equal(result.valid, true);
  assert.ok(result.pitGain > 45);
  assert.ok(result.spinImpulse < 0);
});

test("rejects direct rear impacts, slow contact and cooldown repeats", () => {
  assert.equal(evaluatePitContact({ dx: 0.2, dz: 0, relativeSpeed: 8, grip: 1, cooldown: 0 }).valid, false);
  assert.equal(evaluatePitContact({ dx: 1, dz: 0, relativeSpeed: 1, grip: 1, cooldown: 0 }).valid, false);
  assert.equal(evaluatePitContact({ dx: 1, dz: 0, relativeSpeed: 8, grip: 1, cooldown: 0.2 }).valid, false);
});

test("wet surfaces produce a stronger spin impulse", () => {
  const dry = evaluatePitContact({ dx: -1, dz: 0, relativeSpeed: 5, grip: 1, cooldown: 0 });
  const snow = evaluatePitContact({ dx: -1, dz: 0, relativeSpeed: 5, grip: 0.58, cooldown: 0 });
  assert.ok(Math.abs(snow.spinImpulse) > Math.abs(dry.spinImpulse));
});
