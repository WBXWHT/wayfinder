const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assistantTextFromLine,
  readLastAssistantMessage
} = require("../out/transcript.js");

test("extracts assistant text from Claude and Codex transcript records", () => {
  assert.equal(
    assistantTextFromLine(JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Claude result" }]
      }
    })),
    "Claude result"
  );
  assert.equal(
    assistantTextFromLine(JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Codex result" }]
      }
    })),
    "Codex result"
  );
});

test("reads the latest assistant response from a JSONL transcript", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wayfinder-transcript-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(
    file,
    [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Earlier" }]
        }
      }),
      JSON.stringify({ type: "event_msg", payload: { type: "other" } }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "agent_message", message: "Latest" }
      })
    ].join("\n")
  );

  assert.equal(await readLastAssistantMessage(file), "Latest");
});
