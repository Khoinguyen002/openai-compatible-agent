import fs from "node:fs/promises";
import path from "node:path";
import { syncCronScheduler } from "../../../cron/cronManager.js";
import {
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

export const extensionImplementations = {
  list_extensions: async () => {
    const [tools, crons] = await Promise.all([
      readRegistry(TOOL_DECLARATION),
      readRegistry(CRON_DECLARATION),
    ]);
    return {
      tools: tools.map((t: any) => ({
        name: t.function?.name,
        description: t.function?.description,
      })),
      crons: crons.map((c: any) => ({
        name: c.name,
        expression: c.expression,
        description: c.description,
        active: c.active !== false,
      })),
    };
  },

  register_tool: async (args: {
    name: string;
    description: string;
    parameters: any;
    code: string;
  }) => {
    try {
      const { name, description, parameters, code } = args;
      const scriptPath = `workspace/tools/implementations/${name}.js`;
      const fullScriptPath = path.resolve(process.cwd(), scriptPath);

      await fs.mkdir(path.dirname(fullScriptPath), { recursive: true });
      await fs.writeFile(fullScriptPath, code, "utf-8");

      const currentTools = await readRegistry(TOOL_DECLARATION);
      const filteredTools = currentTools.filter(
        (t: any) => !(t.function && t.function.name === name),
      );
      filteredTools.push({
        type: "function",
        function: { name, description, parameters },
        scriptPath,
      });

      await fs.mkdir(path.dirname(TOOL_DECLARATION), { recursive: true });
      await fs.writeFile(TOOL_DECLARATION, JSON.stringify(filteredTools, null, 2), "utf-8");

      return { success: true, message: `Custom Tool [${name}] registered and deployed successfully.` };
    } catch (err: any) {
      return { success: false, error: `Failed to register tool: ${err.message}` };
    }
  },

  register_cron: async (args: {
    name: string;
    expression: string;
    description: string;
    prompt: string;
    active?: boolean;
  }) => {
    try {
      const { name, expression, description, prompt, active = true } = args;

      const currentCrons = await readRegistry(CRON_DECLARATION);
      const filteredCrons = currentCrons.filter((c: any) => c.name !== name);
      filteredCrons.push({ name, expression, description, prompt, active });

      await fs.mkdir(path.dirname(CRON_DECLARATION), { recursive: true });
      await fs.writeFile(CRON_DECLARATION, JSON.stringify(filteredCrons, null, 2), "utf-8");
      await syncCronScheduler();

      return { success: true, message: `Prompt Cron [${name}] scheduled successfully.` };
    } catch (err: any) {
      return { success: false, error: `Failed to register cron: ${err.message}` };
    }
  },

  toggle_extension: async (args: {
    type: "tool" | "cron";
    name: string;
    active: boolean;
  }) => {
    try {
      const { type, name, active } = args;

      if (type === "cron") {
        const crons = await readRegistry(CRON_DECLARATION);
        const idx = crons.findIndex((c: any) => c.name === name);
        if (idx === -1) return { success: false, error: `Cron '${name}' not found.` };
        crons[idx] = { ...crons[idx], active };
        await fs.writeFile(CRON_DECLARATION, JSON.stringify(crons, null, 2), "utf-8");
        await syncCronScheduler();
        return { success: true, message: `Cron '${name}' is now ${active ? "enabled" : "disabled"}.` };
      }

      if (type === "tool") {
        const tools = await readRegistry(TOOL_DECLARATION);
        const idx = tools.findIndex((t: any) => t.function?.name === name);
        if (idx === -1) return { success: false, error: `Tool '${name}' not found.` };
        tools[idx] = { ...tools[idx], active };
        await fs.writeFile(TOOL_DECLARATION, JSON.stringify(tools, null, 2), "utf-8");
        return { success: true, message: `Tool '${name}' is now ${active ? "enabled" : "disabled"}.` };
      }

      return { success: false, error: `Unknown type '${type}'.` };
    } catch (err: any) {
      return { success: false, error: `toggle_extension failed: ${err.message}` };
    }
  },

  delete_extension: async (args: { type: "tool" | "cron"; name: string }) => {
    try {
      const { type, name } = args;
      const registryPath = type === "tool" ? TOOL_DECLARATION : CRON_DECLARATION;

      const currentItems = await readRegistry(registryPath);
      const updatedItems = currentItems.filter((item: any) =>
        type === "tool"
          ? !(item.function && item.function.name === name)
          : item.name !== name,
      );

      await fs.writeFile(registryPath, JSON.stringify(updatedItems, null, 2), "utf-8");

      if (type === "tool") {
        try {
          await fs.unlink(path.resolve(process.cwd(), `workspace/tools/implementations/${name}.js`));
        } catch {}
      } else {
        await syncCronScheduler();
      }

      return { success: true, message: `${type.toUpperCase()} [${name}] has been completely uninstalled.` };
    } catch (err: any) {
      return { success: false, error: `Deletion failure: ${err.message}` };
    }
  },
};
