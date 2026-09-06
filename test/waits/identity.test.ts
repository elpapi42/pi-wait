import assert from "node:assert/strict";
import test from "node:test";
import {
  createGenerationId,
  createWaitId,
  validateMessage,
  validateSeconds,
  validateWaitId,
} from "../../src/waits/identity.js";

test("accepts valid stable wait IDs", () => {
  for (const id of ["deploy", "deploy-check", "a1", "build-42", "a".repeat(64)]) {
    assert.doesNotThrow(() => validateWaitId(id));
  }
});

test("rejects invalid stable wait IDs", () => {
  for (const id of ["", "A", "deploy_check", "deploy--check", "-deploy", "deploy-", "deploy check", "a".repeat(65), "deploy\ncheck", "deploy\u2028check"]) {
    assert.throws(() => validateWaitId(id));
  }
});

test("creates one generated public ID and a distinct UUID-shaped generation ID", () => {
  assert.match(createWaitId(), /^wait-\d{7}$/);
  assert.match(createGenerationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("accepts finite wait seconds from one through 3600", () => {
  for (const seconds of [1, 1.5, 3600]) assert.doesNotThrow(() => validateSeconds(seconds));
  for (const seconds of [0, 3600.1, Infinity, NaN]) assert.throws(() => validateSeconds(seconds));
});

test("rejects an empty wait message after trimming while preserving nonempty text", () => {
  assert.equal(validateMessage("  Check the build.  "), "  Check the build.  ");
  for (const message of ["", "  \t\n"]) assert.throws(() => validateMessage(message));
});
