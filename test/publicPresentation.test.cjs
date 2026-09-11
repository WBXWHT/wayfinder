const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath));

test("public screenshots use simulated data at 2K or higher", () => {
  const images = [
    "docs/assets/public/wayfinder-social-preview-2k.png",
    "docs/assets/public/wayfinder-voyage-overview-2k.png",
    "docs/assets/public/wayfinder-voyage-branch-2k.png"
  ];

  for (const image of images) {
    const png = read(image);
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.ok(png.readUInt32BE(16) >= 2560, image);
    assert.ok(png.readUInt32BE(20) >= 1280, image);
  }
});

test("repository overview uses the public 2K presentation assets", () => {
  const readme = read("README.md").toString("utf8");
  assert.match(readme, /wayfinder-social-preview-2k\.png/);
  assert.match(readme, /wayfinder-voyage-overview-2k\.png/);
  assert.doesNotMatch(readme, /wayfinder-product-hunt-map\.png/);
  assert.doesNotMatch(readme, /WBXWHT/);
});
