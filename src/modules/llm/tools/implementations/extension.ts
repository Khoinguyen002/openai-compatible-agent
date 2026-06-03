import fs from "node:fs/promises";
import path from "node:path";
import { syncCronScheduler } from "../../../cron/cronManager.js";
import {
  BASE_WORKSPACE,
  CRON_DECLARATION,
  TOOL_DECLARATION,
} from "../../../../config/workspace-dirs.js";

async function readRegistry(filePath: string): Promise<any[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export const extensionToolsImplementations = {
  /**
   * 1. REGISTER / UPDATE DYNAMIC TOOL
   */
  register_tool: async (args: {
    name: string;
    description: string;
    parameters: any;
    code: string;
  }) => {
    // Đổi tên hàm thành register_tool
    try {
      const { name, description, parameters, code } = args;
      const scriptPath = `tools/implementations/${name}.js`;
      const fullScriptPath = path.resolve(BASE_WORKSPACE, scriptPath);

      // Ghi file code logic .js của Tool
      await fs.mkdir(path.dirname(fullScriptPath), { recursive: true });
      await fs.writeFile(fullScriptPath, code, "utf-8");

      // Đọc và update Registry file declaration.json của Tool
      const currentTools = await readRegistry(TOOL_DECLARATION);
      const filteredTools = currentTools.filter(
        (t: any) => !(t.function && t.function.name === name),
      );

      filteredTools.push({
        type: "function",
        function: {
          name,
          description,
          parameters,
        },
        scriptPath,
      });

      await fs.mkdir(path.dirname(TOOL_DECLARATION), { recursive: true });
      await fs.writeFile(
        TOOL_DECLARATION,
        JSON.stringify(filteredTools, null, 2),
        "utf-8",
      );

      return {
        success: true,
        message: `Custom Tool [${name}] registered and deployed successfully.`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to register tool: ${err.message}`,
      };
    }
  },

  /**
   * REGISTER / UPDATE PURE PROMPT CRON
   */
  register_cron: async (args: {
    name: string;
    expression: string;
    description: string;
    prompt: string;
  }) => {
    try {
      const { name, expression, description, prompt } = args;

      const currentCrons = await readRegistry(CRON_DECLARATION);
      const filteredCrons = currentCrons.filter((c: any) => c.name !== name);

      // Chỉ lưu cấu hình prompt, đéo lưu code nữa!
      filteredCrons.push({
        name,
        expression,
        description,
        prompt,
      });

      await fs.mkdir(path.dirname(CRON_DECLARATION), { recursive: true });
      await fs.writeFile(
        CRON_DECLARATION,
        JSON.stringify(filteredCrons, null, 2),
        "utf-8",
      );

      // Reload lại bộ nhớ Scheduler
      await syncCronScheduler();

      return {
        success: true,
        message: `Prompt Cron [${name}] scheduled successfully.`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to register cron: ${err.message}`,
      };
    }
  },

  /**
   * DELETE EXTENSION
   */
  delete_extension: async (args: { type: "tool" | "cron"; name: string }) => {
    try {
      const { type, name } = args;
      const registryPath =
        type === "tool" ? TOOL_DECLARATION : CRON_DECLARATION;

      const currentItems = await readRegistry(registryPath);
      const updatedItems = currentItems.filter((item: any) =>
        type === "tool"
          ? !(item.function && item.function.name === name)
          : item.name !== name,
      );

      await fs.writeFile(
        registryPath,
        JSON.stringify(updatedItems, null, 2),
        "utf-8",
      );

      if (type === "tool") {
        try {
          await fs.unlink(
            path.resolve(BASE_WORKSPACE, `tools/implementations/${name}.js`),
          );
        } catch {}
      } else {
        await syncCronScheduler(); // Reload cron nếu xóa cron
      }

      return {
        success: true,
        message: `${type.toUpperCase()} [${name}] has been completely uninstalled.`,
      };
    } catch (err: any) {
      return { success: false, error: `Deletion failure: ${err.message}` };
    }
  },
};
