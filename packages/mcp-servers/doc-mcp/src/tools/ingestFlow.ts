import { google } from "googleapis";
import { toHast } from "@googleworkspace/google-docs-hast";
import { toHtml } from "hast-util-to-html";
import * as crypto from "crypto";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { config } from "../config.js";
import { get_encoding, type Tiktoken } from "tiktoken";

import {
  embedBatch,
  getBlockPointId,
  getBlockMetaByIds,
  deletePointsByIds,
  upsertChunkBatch,
  updateBlockOffsets,
  ChunkUpsert,
} from "../db/vector.js";
import { getSyncEntry, setSyncEntry, getImageDesc, setImageDesc } from "../db/syncState.js";
import { waitForRateLimit } from "../db/rateLimiter.js";

// ─── Turndown setup ───────────────────────────────────────────────────────────
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndownService.use(gfm);
// Replace img tags with readable placeholder (Drive blob URLs are useless)
turndownService.addRule("images", {
  filter: "img",
  replacement: (_content, node: any) => {
    const alt = node.getAttribute?.("alt") || "";
    return alt ? `[Image: ${alt}]` : "[Image]";
  },
});

// ─── Google Auth ──────────────────────────────────────────────────────────────
function getGoogleClients() {
  const clientEmail = config.DOC_MCP_GOOGLE_CLIENT_EMAIL;
  let privateKey = config.DOC_MCP_GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error("Google credentials not configured.");
  }

  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
    ],
  });

  return {
    drive: google.drive({ version: "v3", auth }),
    docs: google.docs({ version: "v1", auth }),
  };
}

// ─── HAST Image Collection ───────────────────────────────────────────────────
/** Collect all img src URLs from a HAST tree. */
function collectImageSrcs(node: any, srcs: Set<string>) {
  if (!node) return;
  if (node.type === "element" && node.tagName === "img" && node.properties?.src) {
    srcs.add(String(node.properties.src));
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectImageSrcs(child, srcs);
  }
}

/** Replace img nodes with description text from descMap. */
function sanitizeHast(node: any, descMap: Map<string, string>) {
  if (!node) return;
  if (node.type === "element" && node.tagName === "img") {
    const src = String(node.properties?.src ?? "");
    const description =
      descMap.get(src) ||
      (node.properties?.alt ? String(node.properties.alt) : "");
    const label = description ? `: ${description}` : "";
    node.tagName = "span";
    node.properties = { className: ["img-placeholder"] };
    node.children = [{ type: "text", value: `[Image${label}]` }];
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) sanitizeHast(child, descMap);
  }
}

// ─── Vision LLM ──────────────────────────────────────────────────────────────
async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const mimeType = contentType.split(";")[0].trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

async function describeImageWithVision(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const base64 = buffer.toString("base64");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.VISION_MODEL_ID,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
            {
              type: "text",
              text: "Describe this image concisely in 1-3 sentences for a developer reading technical documentation. Focus on UI layout, data shown, flow diagrams, or key visible text.",
            },
          ],
        },
      ],
      max_tokens: 300,
    }),
  });

  if (!res.ok) {
    console.error(`[Vision] API error: ${res.status}`);
    return "";
  }
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Process all images in a HAST tree:
 * 1. Download image binary
 * 2. Check Redis cache by binary hash
 * 3. Call vision LLM if cache miss
 * 4. Return src→description map
 */
async function processImages(hast: any): Promise<Map<string, string>> {
  const descMap = new Map<string, string>();

  if (!config.VISION_MODEL_ID) {
    // Vision not configured — fall back to alt text only
    return descMap;
  }

  const srcs = new Set<string>();
  collectImageSrcs(hast, srcs);
  if (srcs.size === 0) return descMap;

  console.error(`[Vision] Processing ${srcs.size} image(s)...`);

  for (const src of srcs) {
    const image = await downloadImage(src);
    if (!image) {
      console.error(`[Vision] Failed to download: ${src.substring(0, 60)}...`);
      continue;
    }

    const imageHash = crypto.createHash("md5").update(image.buffer).digest("hex");

    // Check Redis cache
    const cached = await getImageDesc(imageHash);
    if (cached) {
      console.error(`[Vision] Cache hit for image hash ${imageHash.substring(0, 8)}`);
      descMap.set(src, cached);
      continue;
    }

    // Call vision LLM
    console.error(`[Vision] Describing image hash ${imageHash.substring(0, 8)}...`);
    const description = await describeImageWithVision(image.buffer, image.mimeType);

    if (description) {
      await setImageDesc(imageHash, description);
      descMap.set(src, description);
      console.error(`[Vision] Stored: "${description.substring(0, 80)}..."`);
    }
  }

  return descMap;
}

// ─── HTML → Markdown ─────────────────────────────────────────────────────────
export async function googleDocToMarkdown(
  docJson: any
): Promise<string> {
  const hast = toHast(docJson);
  const descMap = await processImages(hast);
  sanitizeHast(hast, descMap);
  const html = toHtml(hast as any);
  // 1. Strip inline styles/attrs from table/row/cell tags
  let cleanHtml = html.replace(
    /<(table|thead|tbody|tr|td|th)(\s[^>]*)>/gi,
    (_, tag) => `<${tag}>`
  );
  // 2. Fix tables for turndown-plugin-gfm:
  //    - Strip <p> wrappers inside cells (GFM requires inline content only)
  //    - Strip <span> attributes (inline styles break cell content parsing)
  //    - Convert first <tr>'s <td> → <th> so isHeadingRow() returns true
  //      (Google Docs never uses <th>; without this the table rule doesn't fire)
  cleanHtml = cleanHtml.replace(
    /<table[\s\S]*?<\/table>/gi,
    (tableBlock) => {
      let cleaned = tableBlock
        .replace(/<\/?p[^>]*>/gi, "")           // strip <p> wrappers
        .replace(/<span[^>]*>/gi, "")           // strip <span> open tags w/ attrs
        .replace(/<\/span>/gi, "");             // strip </span>
      // Promote first <tr>'s cells to <th> so GFM table rule fires
      let firstRow = true;
      return cleaned.replace(/<tr>([\s\S]*?)<\/tr>/gi, (rowMatch, rowContent) => {
        if (firstRow) {
          firstRow = false;
          return "<tr>" +
            rowContent
              .replace(/<td>/gi, "<th>")
              .replace(/<\/td>/gi, "</th>") +
            "</tr>";
        }
        return rowMatch;
      });
    }
  );
  return turndownService.turndown(cleanHtml);

}

/**
 * Convert a multi-tab Google Doc to a single Markdown string.
 * Each tab becomes a top-level section separated by ---.
 */
async function docToMarkdown(docData: any): Promise<string> {
  if (docData.tabs && docData.tabs.length > 0) {
    const tabMarkdowns: string[] = [];
    for (const tab of docData.tabs as any[]) {
      if (!tab.documentTab?.body) continue;
      const tabTitle = tab.tabProperties?.title || "Tab";
      // Spread full documentTab so toHast resolves inline objects per-tab
      const tabDoc = { ...docData, ...tab.documentTab };
      const md = await googleDocToMarkdown(tabDoc);
      tabMarkdowns.push(`# ${tabTitle}\n\n${md}`);
    }
    return tabMarkdowns.join("\n\n---\n\n");
  }
  // Single-tab (legacy) document
  return googleDocToMarkdown(docData);

}

// ─── Chunking ─────────────────────────────────────────────────────────────────
/**
 * Split Markdown at headings (#, ##), merge small sections up to MAX_CHUNK_SIZE.
 * Sections exceeding MAX_CHUNK_SIZE are split at the nearest newline boundary.
 *
 * Effective MAX_CHUNK_SIZE is capped so that even the worst-case content
 * (all-Thai, ~3 cl100k tokens/char × TOKEN_SAFETY_MULTIPLIER) stays within
 * 40% of EMBEDDING_MAX_TOKENS — guaranteeing at least 2 chunks can fit per batch
 * regardless of which embedding model is configured.
 */
function chunkMarkdown(markdown: string): string[] {
  // Worst-case Thai tokenization: 3 cl100k tokens/char × 1.4 safety = ~4.2 tokens/char
  const worstCaseTokensPerChar = 3 * TOKEN_SAFETY_MULTIPLIER;
  // Allow each chunk to use at most 40% of the token budget
  const maxCharsFromBudget = Math.max(
    500,
    Math.floor((config.EMBEDDING_MAX_TOKENS * 0.4) / worstCaseTokensPerChar)
  );
  const MAX_CHUNK_SIZE = Math.min(config.MAX_CHUNK_SIZE, maxCharsFromBudget);

  console.error(
    `[Chunk] effectiveChunkSize=${MAX_CHUNK_SIZE} ` +
    `(config=${config.MAX_CHUNK_SIZE}, budgetCap=${maxCharsFromBudget}, ` +
    `maxTokens=${config.EMBEDDING_MAX_TOKENS})`
  );


  // Split at markdown headings (keep the heading in the next chunk)
  const sections = markdown
    .split(/(?=\n#{1,2} )/g)
    .filter((s) => s.trim().length > 0);

  const chunks: string[] = [];
  let current = "";

  for (let section of sections) {
    // Section exceeds MAX_CHUNK_SIZE → split at newline boundaries
    while (section.length > MAX_CHUNK_SIZE) {
      if (current.length > 0) {
        chunks.push(current);
        current = "";
      }
      // Find the nearest newline in the second half of the window
      // to avoid cutting mid-line (table row, sentence, etc.)
      let cutAt = MAX_CHUNK_SIZE;
      const newlineIdx = section.lastIndexOf("\n", MAX_CHUNK_SIZE);
      if (newlineIdx > MAX_CHUNK_SIZE * 0.5) {
        cutAt = newlineIdx + 1; // include the \n in the current chunk
      }
      chunks.push(section.substring(0, cutAt));
      section = section.substring(cutAt);
    }

    if (
      current.length > 0 &&
      current.length + section.length > MAX_CHUNK_SIZE
    ) {
      chunks.push(current);
      current = section;
    } else {
      current += section;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function calculateHash(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

// ─── Batch Packing ────────────────────────────────────────────────────────────
/**
 * Token counter using tiktoken cl100k_base (GPT-4 tokenizer).
 * cl100k_base is used as a close approximation for LLaMA-2 based models.
 * A 1.4x safety multiplier is applied because LLaMA-2's SentencePiece tokenizer
 * tokenizes Thai/multilingual text significantly worse than cl100k_base.
 * Encoder is initialized once at module level to avoid repeated WASM loads.
 */
let _enc: Tiktoken | null = null;
function getEncoder(): Tiktoken {
  if (!_enc) _enc = get_encoding("cl100k_base");
  return _enc;
}

const TOKEN_SAFETY_MULTIPLIER = 1.4;

function countTokens(text: string): number {
  const enc = getEncoder();
  return Math.ceil(enc.encode(text).length * TOKEN_SAFETY_MULTIPLIER);
}

interface BlockToEmbed {
  index: number;
  offset: number;
  text: string;
  hash: string;
  pointId: string;
}

function packIntoBatches(
  blocks: BlockToEmbed[],
  maxTokens: number
): BlockToEmbed[][] {
  const batches: BlockToEmbed[][] = [];
  let current: BlockToEmbed[] = [];
  let currentTokens = 0;

  for (const block of blocks) {
    const blockTokens = countTokens(block.text);
    if (current.length > 0 && currentTokens + blockTokens > maxTokens) {
      batches.push(current);
      current = [block];
      currentTokens = blockTokens;
    } else {
      current.push(block);
      currentTokens += blockTokens;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ─── Core Sync ────────────────────────────────────────────────────────────────
export async function syncSingleDocument(
  fileId: string,
  driveModifiedTime: string,
  title: string
): Promise<{
  synced: boolean;
  content: string;
  upsertedCount?: number;
  skippedCount?: number;
}> {
  const { docs } = getGoogleClients();

  // 1. Fetch doc with ALL tabs content + convert to Markdown
  const docRes = await docs.documents.get({
    documentId: fileId,
    includeTabsContent: true,  // fetch all document tabs
  } as any);
  const markdown = await docToMarkdown(docRes.data);

  // 2. Check sync state — skip embedding if unchanged
  const syncEntry = await getSyncEntry(fileId);
  if (syncEntry?.modifiedTime === driveModifiedTime) {
    console.error(`[Sync] "${title}": unchanged, skipping embedding.`);
    return { synced: false, content: markdown };
  }

  // 3. Chunk Markdown
  const newBlocks = chunkMarkdown(markdown);

  // 4. Get existing block hashes via deterministic IDs
  const oldBlockCount = syncEntry?.blockCount ?? 0;
  const oldPointIds = Array.from({ length: oldBlockCount }, (_, i) =>
    getBlockPointId(fileId, i)
  );
  const existingMeta = await getBlockMetaByIds(oldPointIds);

  // 5. Diff blocks
  const blocksToEmbed: BlockToEmbed[] = [];
  const blocksToUpdateOffset: { pointId: string; offset: number }[] = [];
  let skippedCount = 0;
  let charOffset = 0;

  for (let i = 0; i < newBlocks.length; i++) {
    const text = newBlocks[i];
    const hash = calculateHash(text);
    const pointId = getBlockPointId(fileId, i);
    const existing = existingMeta[pointId];

    if (existing && existing.hash === hash) {
      // Content unchanged — but check if offset shifted (due to edits in earlier blocks)
      if (existing.offset !== charOffset) {
        blocksToUpdateOffset.push({ pointId, offset: charOffset });
      }
      skippedCount++;
    } else {
      blocksToEmbed.push({ index: i, offset: charOffset, text, hash, pointId });
    }
    charOffset += text.length;
  }

  // 6. Delete obsolete blocks (doc shrunk)
  const obsoletePointIds = Array.from(
    { length: Math.max(0, oldBlockCount - newBlocks.length) },
    (_, i) => getBlockPointId(fileId, newBlocks.length + i)
  );
  if (obsoletePointIds.length > 0) {
    await deletePointsByIds(obsoletePointIds);
  }

  // 7. Fix stale offsets for unchanged blocks (no re-embed needed)
  await updateBlockOffsets(blocksToUpdateOffset);

  // 8. Batch embed + upsert
  const batches = packIntoBatches(blocksToEmbed, config.EMBEDDING_MAX_TOKENS);
  let upsertedCount = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.error(
      `[Embed] Batch ${b + 1}/${batches.length}: ${batch.length} chunk(s)`
    );

    await waitForRateLimit();
    const vectors = await embedBatch(batch.map((bl) => bl.text));

    const chunkUpserts: ChunkUpsert[] = batch.map((bl, vi) => ({
      pointId: bl.pointId,
      vector: vectors[vi],
      text: bl.text,
      title,
      blockIndex: bl.index,
      blockHash: bl.hash,
      source: "google_drive",
      offset: bl.offset,
    }));

    await upsertChunkBatch(chunkUpserts);
    upsertedCount += batch.length;
  }

  // 8. Update sync state in Redis
  await setSyncEntry(fileId, {
    modifiedTime: driveModifiedTime,
    blockCount: newBlocks.length,
    title,
  });

  console.error(
    `[Sync] "${title}": ${upsertedCount} upserted, ${skippedCount} skipped, ${obsoletePointIds.length} deleted.`
  );

  return { synced: true, content: markdown, upsertedCount, skippedCount };
}
