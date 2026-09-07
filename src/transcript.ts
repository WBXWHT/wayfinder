import * as fs from "fs";

const MAX_TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

export async function readLastAssistantMessage(
  transcriptPath: string | null | undefined
): Promise<string | undefined> {
  if (!transcriptPath) {
    return undefined;
  }
  try {
    const stat = await fs.promises.stat(transcriptPath);
    if (!stat.isFile()) {
      return undefined;
    }
    const length = Math.min(stat.size, MAX_TRANSCRIPT_TAIL_BYTES);
    const handle = await fs.promises.open(transcriptPath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      const lines = buffer.toString("utf8").split(/\r?\n/);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const text = assistantTextFromLine(lines[index]);
        if (text) {
          return text;
        }
      }
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function assistantTextFromLine(line: string): string | undefined {
  if (!line.trim()) {
    return undefined;
  }
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    return assistantText(value);
  } catch {
    return undefined;
  }
}

function assistantText(value: Record<string, unknown>): string | undefined {
  const message = asRecord(value.message);
  if (value.type === "assistant" && message?.role === "assistant") {
    return contentText(message.content);
  }

  const payload = asRecord(value.payload);
  if (
    value.type === "response_item" &&
    payload?.type === "message" &&
    payload.role === "assistant"
  ) {
    return contentText(payload.content);
  }
  if (
    value.type === "event_msg" &&
    payload?.type === "agent_message" &&
    typeof payload.message === "string"
  ) {
    return payload.message.trim() || undefined;
  }

  if (value.role === "assistant") {
    return contentText(value.content);
  }
  return undefined;
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .map((item) => {
      const part = asRecord(item);
      if (!part || !["text", "output_text"].includes(String(part.type))) {
        return "";
      }
      return typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}
