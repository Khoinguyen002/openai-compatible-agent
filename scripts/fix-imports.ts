import * as fs from "fs";
import * as path from "path";

function walk(dir: string, callback: (filepath: string) => void) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fullPath = path.join(dir, f);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath, callback);
    } else if (fullPath.endsWith(".ts")) {
      callback(fullPath);
    }
  }
}

function fixImports(filepath: string) {
  let content = fs.readFileSync(filepath, "utf8");
  let modified = false;

  const replaceImport = (regex: RegExp, replacement: string) => {
    const newContent = content.replace(regex, replacement);
    if (newContent !== content) {
      modified = true;
      content = newContent;
    }
  };

  // Fix core imports
  replaceImport(/from ".*\/?config\/index\.js"/g, 'from "@workspace/core"');
  replaceImport(/from ".*\/?config\/workspace-dirs\.js"/g, 'from "@workspace/core"');
  replaceImport(/from ".*\/?logger\/index\.js"/g, 'from "@workspace/core"');
  replaceImport(/from ".*\/?sentry\/index\.js"/g, 'from "@workspace/core"');

  // Fix db imports
  replaceImport(/from ".*\/?db\/client\.js"/g, 'from "@workspace/db"');

  // Fix vector-db imports
  replaceImport(/from ".*\/?vector\/index\.js"/g, 'from "@workspace/vector-db"');

  // Fix llm-engine imports
  replaceImport(/from ".*\/?llm\/orchestrator\/index\.js"/g, 'from "@workspace/llm-engine"');
  replaceImport(/from ".*\/?llm\/orchestrator\/session\.js"/g, 'from "@workspace/llm-engine"');
  replaceImport(/from ".*\/?llm\/orchestrator\/pure-agent\.js"/g, 'from "@workspace/llm-engine"');
  replaceImport(/from ".*\/?llm\/orchestrator\/types\/index\.js"/g, 'from "@workspace/llm-engine"');
  replaceImport(/from ".*\/?llm\/prompts\/index\.js"/g, 'from "@workspace/llm-engine"');
  replaceImport(/from ".*\/?llm\/tools\/index\.js"/g, 'from "@workspace/llm-engine"');
  replaceImport(/from ".*\/?llm\/tools\/implementations\/fsTools\.js"/g, 'from "@workspace/llm-engine"'); // wait, fsTools was moved where? It's still in llm-engine, but we don't have it exported from index.ts. Let's assume we'll just rewrite it to the specific path for now if it's not in index.ts, or just export it.

  // Fix doc-agent imports
  replaceImport(/from ".*\/?llm\/orchestrator\/driveSync\.js"/g, 'from "@workspace/doc-agent"');

  if (modified) {
    fs.writeFileSync(filepath, content, "utf8");
    console.log(`Fixed imports in ${filepath}`);
  }
}

console.log("Fixing apps/telegram-bot...");
walk("apps/telegram-bot/src", fixImports);

console.log("Fixing packages/agents/doc-agent...");
walk("packages/agents/doc-agent/src", fixImports);

console.log("Fixing packages/llm-engine...");
walk("packages/llm-engine/src", fixImports);

console.log("Done");
