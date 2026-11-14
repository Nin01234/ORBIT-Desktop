const test = require("node:test");
const assert = require("node:assert/strict");
const { validateYouTubeUrl } = require("../youtube-download.cjs");

test("accepts standard YouTube watch links and normalizes them", () => {
  assert.equal(validateYouTubeUrl("https://www.youtube.com/watch?v=abcdefghijk"), "https://www.youtube.com/watch?v=abcdefghijk");
});

test("accepts youtu.be links", () => {
  assert.equal(validateYouTubeUrl("https://youtu.be/abcdefghijk?t=20"), "https://www.youtube.com/watch?v=abcdefghijk");
});

test("rejects non-YouTube hosts", () => {
  assert.throws(() => validateYouTubeUrl("https://example.com/watch?v=abcdefghijk"), /Only YouTube/);
});

test("rejects malformed video IDs", () => {
  assert.throws(() => validateYouTubeUrl("https://youtube.com/watch?v=bad"), /valid YouTube video ID/);
});

test("rejects insecure URLs", () => {
  assert.throws(() => validateYouTubeUrl("http://youtube.com/watch?v=abcdefghijk"), /secure YouTube/);
});
