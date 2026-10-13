import test from "node:test";
import assert from "node:assert/strict";
import { swipeDirection } from "../src/question-swipe";

test("horizontal swipes turn questions while vertical reading and taps do not", () => {
  assert.equal(swipeDirection(-100, 8, -200), "next");
  assert.equal(swipeDirection(100, -8, 200), "prev");
  assert.equal(swipeDirection(-28, 4, -800), "next");
  assert.equal(swipeDirection(28, -4, 800), "prev");
  assert.equal(swipeDirection(12, 2, 900), null);
  assert.equal(swipeDirection(40, 2, 200), null);
  assert.equal(swipeDirection(80, 140, 800), null);
  assert.equal(swipeDirection(-28, 2, 800), null);
});
