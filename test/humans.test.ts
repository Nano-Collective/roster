import assert from "node:assert/strict";
import { test } from "node:test";
import { humanLogins, humanSentence, primaryHuman, readHumans } from "../src/lib/humans.js";
import { orgTokens } from "../src/lib/render.js";

/**
 * An org used to have exactly one human, and the mention callers gated on that one login. A
 * second founder's comment was dropped in silence, which is the worst failure mode here:
 * nothing anywhere says it happened.
 *
 * So both spellings are read. The tests below are mostly about the *silence*: that nobody who
 * is written down gets quietly dropped, and that the gate list carries all of them.
 */

test("the singular human still works, and is a list of one", () => {
  const humans = readHumans({ human: { name: "Will", github: "will-lamerton", marker: "will" } });
  assert.equal(humans.length, 1);
  assert.equal(humans[0]!.github, "will-lamerton");
  assert.equal(humans[0]!.marker, "will");
});

test("a humans list is read in order, and the first is the one the prose addresses", () => {
  const org = {
    humans: [
      { name: "Will", github: "will-lamerton", marker: "will" },
      { name: "Sam", github: "sam-x", marker: "sam" },
    ],
  };
  assert.deepEqual(humanLogins(org), ["will-lamerton", "sam-x"]);
  assert.equal(primaryHuman(org)!.name, "Will");
});

test("somebody written in the old key as well as the list is not counted twice", () => {
  const org = {
    human: { name: "Will", github: "WILL-lamerton" },
    humans: [
      { name: "Will", github: "will-lamerton" },
      { name: "Sam", github: "sam-x" },
    ],
  };
  assert.deepEqual(humanLogins(org), ["will-lamerton", "sam-x"]);
});

test("somebody written only in the old key is kept, not demoted", () => {
  // Deleting them because they were spelled the old way would be a silent loss of access.
  const org = { human: { name: "Sam", github: "sam-x" }, humans: [{ github: "will-lamerton" }] };
  assert.deepEqual(humanLogins(org), ["will-lamerton", "sam-x"]);
});

test("a marker is derived from the name when none is given", () => {
  assert.equal(readHumans({ human: { name: "Will Lamerton", github: "w" } })[0]!.marker, "will");
  assert.equal(readHumans({ human: { github: "sam-x" } })[0]!.marker, "sam");
});

test("no humans at all is an empty list rather than a throw", () => {
  assert.deepEqual(readHumans({}), []);
  assert.deepEqual(readHumans(undefined), []);
  assert.equal(primaryHuman({}), null);
});

test("the gate token is JSON, so the workflow can fromJSON it", () => {
  const tokens = orgTokens({
    org: "acme",
    name: "Acme",
    opsRepo: "acme/roster-ops",
    opsDirName: "roster-ops",
    human: "will-lamerton",
    humanMarker: "will",
    humanLogins: ["will-lamerton", "sam-x"],
    allowedTools: "Bash",
  });
  assert.equal(tokens.HUMAN_LOGINS, '["will-lamerton","sam-x"]');
  assert.deepEqual(JSON.parse(tokens.HUMAN_LOGINS!), ["will-lamerton", "sam-x"]);
});

test("one human is still a one-element list, so the gate has one shape", () => {
  const tokens = orgTokens({
    org: "acme",
    name: "Acme",
    opsRepo: "acme/roster-ops",
    opsDirName: "roster-ops",
    human: "will-lamerton",
    humanMarker: "will",
    allowedTools: "Bash",
  });
  assert.equal(tokens.HUMAN_LOGINS, '["will-lamerton"]');
});

test("a sentence names everybody, because a gate nobody can read is a gate nobody checks", () => {
  const humans = readHumans({
    humans: [
      { name: "Will", github: "w" },
      { name: "Sam", github: "s" },
      { name: "Jo", github: "j" },
    ],
  });
  assert.equal(humanSentence(humans), "Will (@w), Sam (@s) and Jo (@j)");
  assert.equal(humanSentence(humans.slice(0, 1)), "Will (@w)");
  assert.equal(humanSentence([]), "");
});
