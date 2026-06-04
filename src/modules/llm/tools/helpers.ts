import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import util from "node:util";
import {
  TOOL_DECLARATION,
} from "../../../config/workspace-dirs.js";

const execFilePromise = util.promisify(execFile);

export async function getDynamicToolsDeclaration() {
  try {
    const content = await fs.readFile(TOOL_DECLARATION, "utf-8");
    const dynamicTools = JSON.parse(content);

    return dynamicTools
      .filter((tool: any) => tool.active !== false) // skip disabled tools
      .map((tool: any) => ({
        type: tool.type || "function",
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));
  } catch (e) {
    return [];
  }
}

export async function executeDynamicTool(toolName: string, args: any) {
  try {
    const content = await fs.readFile(TOOL_DECLARATION, "utf-8");
    const dynamicTools = JSON.parse(content);

    // Tìm tool dựa theo cấu trúc lồng của OpenRouter schema
    const targetTool = dynamicTools.find(
      (t: any) => t.function?.name === toolName,
    );

    if (!targetTool) {
      return { error: `Tool ${toolName} not found in declaration.json.` };
    }

    if (targetTool.active === false) {
      return { error: `Tool ${toolName} is currently disabled.` };
    }

    const scriptFullPath = path.resolve(process.cwd(), targetTool.scriptPath);

    if (!scriptFullPath.startsWith(path.resolve(process.cwd(), "workspace"))) {
      return {
        error: "Permission Denied: Script path out of workspace scope.",
      };
    }

    const base64Args = Buffer.from(JSON.stringify(args)).toString("base64");

    console.log(`🚀 Executing Dynamic Tool [${toolName}] via child process...`);

    const { stdout, stderr } = await execFilePromise(
      "node",
      [scriptFullPath, base64Args],
      { timeout: 15000 },
    );

    if (stderr && !stdout) {
      return { error: stderr };
    }

    return JSON.parse(stdout.trim());
  } catch (error: any) {
    return { error: `Dynamic tool execution failed: ${error.message}` };
  }
}
