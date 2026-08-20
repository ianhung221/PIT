import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePitContact, evaluatePitOutcome, steeringInput } from "../lib/gameRules.ts";

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
