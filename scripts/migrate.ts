import { Project, FileSystemHost } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
});

async function main() {
  console.log("🚀 Resuming Monorepo Migration Part 3...");

  const moveDir = (srcPath: string, destPath: string) => {
    const absDest = path.resolve(process.cwd(), destPath);
    console.log(`Moving ${srcPath} -> ${absDest}`);
    const dir = project.getDirectory(srcPath);
    if (dir) {
      dir.move(absDest);
    } else {
      console.warn(`⚠️ Directory not found: ${srcPath}`);
    }
  };

  const moveFile = (srcPath: string, destPath: string) => {
    const absDest = path.resolve(process.cwd(), destPath);
    console.log(`Moving ${srcPath} -> ${absDest}`);
    const file = project.getSourceFile(srcPath);
    if (file) {
      file.move(absDest);
    } else {
      console.warn(`⚠️ File not found: ${srcPath}`);
    }
  };

  // Create apps/telegram-bot/src
  fs.mkdirSync("apps/telegram-bot/src", { recursive: true });

  // 6. Move rest of src to apps/telegram-bot/src
  moveDir("src/modules/bot", "apps/telegram-bot/src/bot");
  moveDir("src/modules/cron", "apps/telegram-bot/src/cron");
  moveDir("src/modules/export", "apps/telegram-bot/src/export");
  moveDir("src/modules/gateway", "apps/telegram-bot/src/gateway");
  moveDir("src/modules/queue", "apps/telegram-bot/src/queue");
  moveFile("src/main.ts", "apps/telegram-bot/src/main.ts");
  moveFile("src/export-conversations.ts", "apps/telegram-bot/src/export-conversations.ts");

  console.log("💾 Saving project and updating imports...");
  await project.save();

  console.log("✅ Migration part 3 complete!");
}

main().catch(console.error);
