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
    "docs/assets/public/wayfinder-voyage-branch-2k.png",
    "website/wayfinder-social-preview-2k.png"
  ];

  for (const image of images) {
    const png = read(image);
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.ok(png.readUInt32BE(16) >= 2560, image);
    assert.ok(png.readUInt32BE(20) >= 1280, image);
  }
});

test("phone typography uses bundled open-source web fonts", () => {
  for (const font of [
    "website/fonts/wayfinder-sans-400.woff2",
    "website/fonts/wayfinder-sans-700.woff2"
  ]) {
    const data = read(font);
    assert.equal(data.toString("ascii", 0, 4), "wOF2");
    assert.ok(data.length < 100_000, font);
  }

  const license = read("website/fonts/OFL.txt").toString("utf8");
  const styles = read("website/styles.css").toString("utf8");
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(
    styles,
    /@media \(max-width: 540px\)[\s\S]*?body \{[\s\S]*?"Wayfinder Sans"/
  );
});

test("repository overview uses the public 2K presentation assets", () => {
  const readme = read("README.md").toString("utf8");
  assert.match(readme, /wayfinder-social-preview-2k\.png/);
  assert.match(readme, /wayfinder-voyage-overview-2k\.png/);
  assert.match(readme, /No account\. No telemetry\. No cloud sync\./);
  assert.match(readme, /Wayfinder-Alpha-0\.3\.14-macOS-aarch64\.dmg/);
  assert.match(readme, /Wayfinder-Alpha-0\.3\.14-macOS-x86_64\.dmg/);
  assert.match(readme, /Wayfinder-Alpha-0\.3\.14-Windows-x86_64\.exe/);
  assert.match(readme, /collection cursors, and project maps/);
  assert.doesNotMatch(readme, /collection cursors, and snapshots/);
  assert.doesNotMatch(readme, /wayfinder-product-hunt-map\.png/);
  assert.doesNotMatch(readme, /WBXWHT/);
});

test("website metadata states the product category and current platforms", () => {
  const html = read("website/index.html").toString("utf8");
  assert.match(html, /本地优先的 AI 协作航迹桌面应用/);
  assert.match(html, /提供 macOS 与 Windows 版本/);
  assert.match(
    html,
    /把 AI 协作中的目标、分叉与证据，整理成一张可回看的项目航海图/
  );
  assert.match(html, /照常使用 AI，Wayfinder 自动整理成图/);
  assert.match(html, /rel="canonical" href="https:\/\/wayfinder-ai\.pages\.dev\/"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:site_name" content="Wayfinder"/);
  assert.match(html, /property="og:locale" content="zh_CN"/);
  assert.match(html, /property="og:image:width" content="2560"/);
  assert.match(html, /property="og:image:alt" content="Wayfinder [^"]+"/);
  assert.match(html, /name="twitter:image:alt" content="Wayfinder [^"]+"/);
  assert.match(html, /"@type": "SoftwareApplication"/);
  assert.match(html, /"softwareVersion": "0\.3\.14"/);
  assert.match(
    read("website/robots.txt").toString("utf8"),
    /Sitemap: https:\/\/wayfinder-ai\.pages\.dev\/sitemap\.xml/
  );
  assert.match(
    read("website/sitemap.xml").toString("utf8"),
    /https:\/\/wayfinder-ai\.pages\.dev\/privacy\.html/
  );
  assert.match(
    read("website/sitemap.xml").toString("utf8"),
    /<lastmod>2026-09-12<\/lastmod>/
  );
});

test("contribution guide defines durable commit and privacy standards", () => {
  const guide = read("CONTRIBUTING.md").toString("utf8");
  assert.match(guide, /feat\(map\): preserve the selected voyage during refresh/);
  assert.match(guide, /Why:[\s\S]*What:[\s\S]*Verification:/);
  assert.ok(guide.includes("Never commit a real `~/.wayfinder` workspace"));
});

test("public support and release documents are explicit and current", () => {
  const security = read("SECURITY.md").toString("utf8");
  const privacy = read("PRIVACY.md").toString("utf8");
  const privacyPage = read("website/privacy.html").toString("utf8");
  const changelog = read("CHANGELOG.md").toString("utf8");
  const bugTemplate = read(
    ".github/ISSUE_TEMPLATE/bug-report.yml"
  ).toString("utf8");

  assert.match(security, /private vulnerability reporting/);
  assert.ok(security.includes("`~/.wayfinder`"));
  assert.match(security, /\| 0\.3\.14 \| Yes \|/);
  assert.match(privacy, /file-change summaries, and map state/);
  assert.doesNotMatch(privacy, /Snapshot exclusions/);
  assert.doesNotMatch(privacyPage, /代码快照|和快照存储/);
  assert.match(privacyPage, /文件变化摘要和航海图/);
  assert.match(changelog, /## \[0\.3\.14\] - 2026-09-12/);
  assert.match(changelog, /Windows x64 installer/);
  assert.match(bugTemplate, /synthetic data/);
});
