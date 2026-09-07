const fs = require("node:fs");
const path = require("node:path");

const { ShadowRepo } = require("../out/shadowRepo.js");
const {
  forestMetadataForChapter
} = require("../out/conversationForest.js");
const {
  createId,
  mutateProjectState,
  readProjectConfig
} = require("../out/storage.js");

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  if (rootIndex < 0 || !args[rootIndex + 1]) {
    throw new Error(
      "Usage: node scripts/import-memory-history.cjs --root <workspace> <jsonl...>"
    );
  }

  const root = fs.realpathSync(args[rootIndex + 1]);
  const files = args.filter(
    (_value, index) => index !== rootIndex && index !== rootIndex + 1
  );
  if (files.length === 0) {
    throw new Error("At least one session memory JSONL file is required.");
  }

  const records = readRecords(files);
  const sessionIds = [...new Set(records.map((entry) => entry.sessionId))];
  const importedAt = new Date().toISOString();

  const result = await mutateProjectState(root, async (current) => {
    const recordById = new Map(
      records.map(({ record }) => [record.message_id, record])
    );
    let updated = 0;
    for (const node of current.nodes) {
      const record = node.source?.messageId
        ? recordById.get(node.source.messageId)
        : undefined;
      if (record && node.source) {
        const chapter = chapterFor(record);
        const forest = forestMetadataForChapter(chapter);
        if (
          node.source.chapter !== chapter ||
          JSON.stringify(node.source.forest) !== JSON.stringify(forest)
        ) {
          node.source.chapter = chapter;
          node.source.forest = forest;
          updated += 1;
        }
      }
    }

    const existingMessageIds = new Set(
      current.nodes
        .map((node) => node.source?.messageId)
        .filter(Boolean)
    );
    const existingNodeIds = new Set(current.nodes.map((node) => node.id));
    const affectedBranches = new Set();
    let baseline;
    let imported = 0;
    for (const { record, sessionId, timestamp } of records) {
      if (existingMessageIds.has(record.message_id)) {
        continue;
      }
      const id = `import-${record.message_id}`;
      if (existingNodeIds.has(id)) {
        throw new Error(`History node ID collision: ${id}`);
      }
      if (!baseline) {
        const config = await readProjectConfig(root);
        const shadow = new ShadowRepo(root, config.maxFileSizeMB);
        baseline = await shadow.capture(
          createId("import-baseline"),
          `Imported history: ${sessionIds.join(", ")}`
        );
      }
      const branchId = `imported-${sessionId}`;
      if (!current.branches.some((branch) => branch.id === branchId)) {
        current.branches.push({
          id: branchId,
          name: `历史会话 · ${sessionId.slice(-6)}`,
          createdAt: importedAt
        });
      }
      current.nodes.push({
        id,
        kind: "imported",
        sessionId,
        branchId,
        prompt: clean(record.intent) || "历史会话",
        response: summaryFor(record),
        startedAt: timestamp,
        completedAt: timestamp,
        snapshotBefore: baseline.commit,
        snapshotAfter: baseline.commit,
        files: [],
        actions: [],
        validation: { status: "skipped" },
        source: {
          type: "trae-memory",
          messageId: record.message_id,
          importedAt,
          chapter: chapterFor(record),
          forest: forestMetadataForChapter(chapterFor(record))
        }
      });
      existingMessageIds.add(record.message_id);
      existingNodeIds.add(id);
      affectedBranches.add(branchId);
      imported += 1;
    }

    for (const branchId of affectedBranches) {
      const branchNodes = current.nodes
        .filter((node) => node.branchId === branchId)
        .sort(
          (a, b) =>
            a.completedAt.localeCompare(b.completedAt) ||
            a.id.localeCompare(b.id)
        );
      let parentId;
      for (const node of branchNodes) {
        node.parentId = parentId;
        parentId = node.id;
      }
    }

    return { imported, updated };
  });

  if (result.imported === 0 && result.updated === 0) {
    console.log("No new history entries to import.");
    return;
  }
  console.log(
    JSON.stringify(
      {
        imported: result.imported,
        updated: result.updated,
        totalSourceRecords: records.length,
        sessionIds,
        branchIds: sessionIds.map((sessionId) => `imported-${sessionId}`)
      },
      null,
      2
    )
  );
}

function readRecords(files) {
  const records = [];
  const seen = new Set();
  for (const file of files) {
    const content = fs.readFileSync(path.resolve(file), "utf8");
    const sessionId = sessionIdFor(file);
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (!line.trim()) {
        continue;
      }
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSON at ${path.resolve(file)}:${index + 1}: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
      if (!record.message_id || seen.has(record.message_id)) {
        continue;
      }
      seen.add(record.message_id);
      records.push({
        record,
        sessionId,
        timestamp: toIso(
          record.message_summary_time,
          `${path.resolve(file)}:${index + 1}`
        )
      });
    }
  }
  return records.sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) ||
      a.record.message_id.localeCompare(b.record.message_id)
  );
}

function summaryFor(record) {
  const sections = [];
  if (record.outcome) {
    sections.push(`结果\n${clean(record.outcome)}`);
  }
  if (Array.isArray(record.actions) && record.actions.length > 0) {
    sections.push(`行动\n${record.actions.map((item) => `- ${clean(item)}`).join("\n")}`);
  }
  if (Array.isArray(record.learned) && record.learned.length > 0) {
    sections.push(`沉淀\n${record.learned.map((item) => `- ${clean(item)}`).join("\n")}`);
  }
  return sections.join("\n\n").slice(0, 4_000);
}

function sessionIdFor(file) {
  return (
    path.basename(file).match(/^session_memory_(.+)\.jsonl$/)?.[1] ||
    "trae-history"
  );
}

function toIso(value, location) {
  const parsed = new Date(String(value || "").replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid message_summary_time at ${location}`);
  }
  return parsed.toISOString();
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function chapterFor(record) {
  const text = clean(record.intent).toLowerCase();

  if (
    /api|动态分成|段位|健康分|分成率|区域.*门槛|收益部分.*平台级|fragment/.test(
      text
    )
  ) {
    return "API 动态分成";
  }
  if (/tags|内容标签|关系标签|重点内容|粉丝团|10级|送礼关系/.test(text)) {
    return "AI 助手 · Tags";
  }
  if (/tips|新内容破冰|播中冷场|金主沉默|口播/.test(text)) {
    return "AI 助手 · Tips";
  }
  if (
    /trae|插件|shadow git|hook|vsix|代码回退|侧栏|对抗式审查|单元测试|历史会话导入|版本更新|新版布局|0\.\d+\.\d+/.test(
      text
    )
  ) {
    return "TRAE 插件开发";
  }
  if (
    /wayfinder|决策复盘|决策路径|个人经验|经验复利|决策留痕|决策可视化|会话森林|知识图谱.*样式|图谱化|线性.*历史/.test(
      text
    )
  ) {
    return "Wayfinder 产品";
  }
  if (/时间轴|可视化方案|任务进度|经验地图/.test(text)) {
    return "Wayfinder 产品";
  }
  if (/ai ?助手|实时ai助手|task helper|应用/.test(text)) {
    return "AI 助手";
  }
  if (/小而美|有趣|创意|项目方向|项目建议|产品创意|github 项目/.test(text)) {
    return "项目方向探索";
  }
  if (/项目方案|面试官|项目经历|示例开发/.test(text)) {
    return "需求与设计";
  }
  return "其他讨论";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
