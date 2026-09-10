const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const spdxLicenses = require("spdx-license-list/full");

const root = path.resolve(__dirname, "..");
const manifest = path.join(root, "companion", "src-tauri", "Cargo.toml");
const outputDir = path.join(root, "companion", "generated");
const output = path.join(outputDir, "RUST_THIRD_PARTY_LICENSES.txt");
const metadata = JSON.parse(execFileSync("cargo", [
  "metadata",
  "--format-version",
  "1",
  "--locked",
  "--manifest-path",
  manifest
], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["ignore", "pipe", "inherit"]
}));

const packages = metadata.packages
  .filter((item) => item.name !== "wayfinder-companion")
  .sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)
  );
const licenseBodies = new Map();
const records = [];

for (const item of packages) {
  const packageRoot = path.dirname(item.manifest_path);
  const files = new Set(fs.readdirSync(packageRoot)
    .filter((name) =>
      /^(licen[cs]e|copying|notice|copyright)([._-]|$)/i.test(name)
    )
    .filter((name) => fs.statSync(path.join(packageRoot, name)).isFile())
    .map((name) => path.join(packageRoot, name)));
  if (item.license_file) {
    const declared = path.resolve(packageRoot, item.license_file);
    if (fs.existsSync(declared) && fs.statSync(declared).isFile()) {
      files.add(declared);
    }
  }
  const references = [];
  for (const file of [...files].sort()) {
    const body = fs.readFileSync(file, "utf8").trim();
    if (!body) continue;
    references.push(addLicenseBody(body));
  }
  records.push({ item, references });
}

for (const record of records) {
  if (record.references.length > 0) continue;
  const repository = normalizeRepository(record.item.repository);
  const donor = repository && records.find((candidate) =>
    candidate.references.length > 0 &&
    normalizeRepository(candidate.item.repository) === repository &&
    candidate.item.license === record.item.license
  );
  if (donor) {
    record.references.push(...donor.references);
  }
}

for (const record of records) {
  if (record.references.length > 0) continue;
  const identifiers = licenseIdentifiers(record.item.license);
  for (const identifier of identifiers) {
    const license = spdxLicenses[identifier];
    if (!license?.licenseText) continue;
    record.references.push(addLicenseBody(
      `SPDX ${identifier}: ${license.name}\n\n${license.licenseText.trim()}`
    ));
  }
}

const unresolved = records.filter((record) => record.references.length === 0);
if (unresolved.length > 0) {
  throw new Error(
    "Missing packaged Rust license text for: " +
      unresolved
        .map(({ item }) => `${item.name}@${item.version}`)
        .join(", ")
  );
}

const packageLines = records.map(({ item, references }) =>
  `${item.name} ${item.version} | ${item.license || "unspecified"} | ` +
    `${references.join(", ")} | ${item.authors.join("; ") || "authors unspecified"}`
);
const bodies = [...licenseBodies.values()].map(({ id, body }) =>
  `===== ${id} =====\n${body}`
);
const report = [
  "Wayfinder Companion Rust Third-Party Licenses",
  "",
  "Resolved packages:",
  ...packageLines,
  "",
  "License texts:",
  ...bodies,
  ""
].join("\n");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(output, report);
process.stdout.write(
  `Generated ${output} for ${packages.length} Rust packages.\n`
);

function normalizeRepository(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function licenseIdentifiers(expression) {
  return [...new Set(
    String(expression || "")
      .replace(/\//g, " OR ")
      .match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) || []
  )].filter((value) => !["AND", "OR", "WITH"].includes(value));
}

function addLicenseBody(body) {
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (!licenseBodies.has(digest)) {
    licenseBodies.set(digest, {
      id: `L${licenseBodies.size + 1}`,
      body
    });
  }
  return licenseBodies.get(digest).id;
}
