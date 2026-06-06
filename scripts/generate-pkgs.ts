import * as fs from "fs";

function createPkg(dir: string, name: string) {
  fs.writeFileSync(`${dir}/package.json`, JSON.stringify({
    name: `@workspace/${name}`,
    version: "1.0.0",
    type: "module",
    main: "dist/index.js",
    scripts: { build: "tsc" }
  }, null, 2));

  fs.writeFileSync(`${dir}/tsconfig.json`, JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "./dist",
      rootDir: "./src",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true
    },
    include: ["src/**/*"]
  }, null, 2));
}

createPkg("packages/core", "core");
createPkg("packages/db", "db");
createPkg("packages/vector-db", "vector-db");
createPkg("packages/llm-engine", "llm-engine");
createPkg("packages/agents/doc-agent", "doc-agent");

// App package.json
fs.writeFileSync(`apps/telegram-bot/package.json`, JSON.stringify({
  name: "@workspace/telegram-bot",
  version: "1.0.0",
  type: "module",
  main: "dist/main.js",
  scripts: {
    build: "tsc",
    start: "node dist/main.js",
    dev: "tsx watch src/main.ts",
    export: "tsx src/export-conversations.ts",
    analyze: "tsx ../../scripts/analyze-sessions.ts"
  },
  dependencies: {
    "@workspace/core": "workspace:*",
    "@workspace/db": "workspace:*",
    "@workspace/vector-db": "workspace:*",
    "@workspace/llm-engine": "workspace:*",
    "@workspace/doc-agent": "workspace:*"
  }
}, null, 2));

fs.writeFileSync(`apps/telegram-bot/tsconfig.json`, JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    outDir: "./dist",
    rootDir: "./src",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true
  },
  include: ["src/**/*"]
}, null, 2));

console.log("Workspace packages generated!");
