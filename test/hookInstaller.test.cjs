const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const originalLoad = Module._load;
const sectionSettings = {
  wayfinder: {}
};
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {
      workspace: {
        getConfiguration(section) {
          return {
            get(name, fallback) {
              return sectionSettings[section]?.[name] ?? fallback;
            },
            inspect(name) {
              const value = sectionSettings[section]?.[name];
              return value === undefined
                ? { defaultValue: name === "validationCommand" ? "" : undefined }
                : { workspaceValue: value };
            }
          };
        }
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  areTraeHooksInstalled,
  installTraeHooks,
  mergeHooksForTest
} = require("../out/hookInstaller.js");
const {
  projectDataDir,
  readProjectConfig
} = require("../out/storage.js");

test("connection requires all hooks from the current extension", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-install-"));
  const extensionPath = "/extensions/wayfinder-0.1.1";
  const hooksDir = path.join(root, ".trae");
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(hooksDir, "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "/usr/bin/env node '/extensions/wayfinder-0.1.1/out/hook.js' --wayfinder-hook",
                timeout: 30
              }
            ]
          }
        ]
      }
    })
  );

  assert.equal(await areTraeHooksInstalled(root, extensionPath), false);

  const complete = mergeHooksForTest(
    { version: 1, hooks: {} },
    path.join(extensionPath, "out", "cli.js")
  );
  fs.writeFileSync(path.join(hooksDir, "hooks.json"), JSON.stringify(complete));
  assert.equal(await areTraeHooksInstalled(root, extensionPath), true);
  assert.equal(
    await areTraeHooksInstalled(root, "/extensions/wayfinder-older"),
    false
  );
});

test("install refuses to overwrite malformed existing hooks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-malformed-"));
  const hooksDir = path.join(root, ".trae");
  const hooksPath = path.join(hooksDir, "hooks.json");
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hooksPath, "{ broken json");

  await assert.rejects(
    installTraeHooks(root, "/extensions/wayfinder"),
    /未修改现有 Hooks/
  );
  assert.equal(fs.readFileSync(hooksPath, "utf8"), "{ broken json");
});

test("an explicit empty validation command remains disabled on reconnect", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-config-"));
  const root = path.join(sandbox, "project");
  process.env.WAYFINDER_HOME = path.join(sandbox, "data");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node test.js" } })
  );
  const errorLog = path.join(projectDataDir(root), "hook-errors.log");
  fs.mkdirSync(path.dirname(errorLog), { recursive: true });
  fs.writeFileSync(errorLog, "previous runtime failure\n");
  sectionSettings.wayfinder.validationCommand = "";

  await installTraeHooks(root, "/extensions/wayfinder");
  const config = await readProjectConfig(root);
  assert.equal(config.validationCommand, "");
  assert.equal(fs.readFileSync(errorLog, "utf8"), "previous runtime failure\n");
  delete sectionSettings.wayfinder.validationCommand;
});
