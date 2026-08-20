import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePitContact,
  evaluatePitOutcome,
  isSuspectRecoveryNeeded,
  nextSuspectRecoveryMode,
  steeringInput,
  suspectForwardSpeedScale,
  suspectReverseEscapeYaw,
} from "../lib/gameRules.ts";

const baseContact = {
  localX: 1.7,
  localZ: 1.4,
  suspectHalfWidth: 1,
  suspectHalfLength: 2.2,
  closingSpeed: 6,
  headingDelta: .1,
  cooldown: 0,
  hasCandidate: false,
};

test("maps left and right input to distinct correct steering signs", () => {
  assert.equal(steeringInput(true, false), -1);
  assert.equal(steeringInput(false, true), 1);
  assert.equal(steeringInput(true, true), 0);
});

test("accepts a properly aligned rear-quarter contact", () => {
  const result = evaluatePitContact(baseContact);
  assert.equal(result.valid, true);
  assert.equal(result.side, 1);
});

test("rejects rear impacts, front-side hits, bad headings and unsafe closing speeds", () => {
  assert.equal(evaluatePitContact({ ...baseContact, localX: .2 }).reason, "contact-zone");
  assert.equal(evaluatePitContact({ ...baseContact, localZ: -.5 }).reason, "contact-zone");
  assert.equal(evaluatePitContact({ ...baseContact, headingDelta: 1.1 }).reason, "heading");
  assert.equal(evaluatePitContact({ ...baseContact, closingSpeed: 25 }).reason, "closing-speed");
});

test("prevents repeated scoring during cooldown or an active PIT evaluation", () => {
  assert.equal(evaluatePitContact({ ...baseContact, cooldown: .2 }).reason, "cooldown");
  assert.equal(evaluatePitContact({ ...baseContact, hasCandidate: true }).reason, "active");
});

test("requires both a meaningful spin and loss of control for PIT success", () => {
  const glance = evaluatePitOutcome(0, .3, 30, 27, 1);
  assert.equal(glance.success, false);
  const pit = evaluatePitOutcome(0, 1.1, 30, 18, 2);
  assert.equal(pit.success, true);
  assert.equal(pit.progress, 100);
});

test("starts recovery only after a genuine stall and never during PIT evaluation", () => {
  const stalled = { planarSpeed: .4, forwardSpeed: .2, yawError: 1.1, boundaryRatio: .84, stalledFor: 1.1, pitActive: false };
  assert.equal(isSuspectRecoveryNeeded(stalled), true);
  assert.equal(isSuspectRecoveryNeeded({ ...stalled, stalledFor: .5 }), false);
  assert.equal(isSuspectRecoveryNeeded({ ...stalled, pitActive: true }), false);
  assert.equal(isSuspectRecoveryNeeded({ ...stalled, planarSpeed: 5 }), false);
});

test("does not mistake an ordinary straight-line slowdown for being stuck", () => {
  assert.equal(isSuspectRecoveryNeeded({ planarSpeed: .6, forwardSpeed: .6, yawError: .1, boundaryRatio: .2, stalledFor: 2, pitActive: false }), false);
});

test("runs recovery through braking, reversing, realigning and driving", () => {
  assert.equal(nextSuspectRecoveryMode("braking", .4, 1.1, 0), "reversing");
  assert.equal(nextSuspectRecoveryMode("reversing", 1.3, .8, -4), "realigning");
  assert.equal(nextSuspectRecoveryMode("realigning", .8, .1, 2), "driving");
  assert.equal(nextSuspectRecoveryMode("realigning", 2.5, .8, .3), "braking");
});

test("reduces throttle as the suspect points away from the road", () => {
  assert.equal(suspectForwardSpeedScale(0), 1);
  assert.ok(suspectForwardSpeedScale(.8) > 0 && suspectForwardSpeedScale(.8) < 1);
  assert.equal(suspectForwardSpeedScale(Math.PI / 2), 0);
});

test("backs the rear of the suspect away from either guardrail", () => {
  assert.ok(suspectReverseEscapeYaw(6) < 0);
  assert.ok(suspectReverseEscapeYaw(-6) > 0);
  assert.equal(suspectReverseEscapeYaw(0), 0);
});
