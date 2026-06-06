import { prisma } from "../../../../db/client.js";
import {
  upsertProjectDocument,
  searchProjectMemory,
} from "../../../vector/index.js";

export const projectToolImplementations: Record<
  string,
  (args: any, context?: any) => Promise<any>
> = {
  store_project_knowledge: async (args: { content: string }, context?: any) => {
    if (!context?.sessionId) {
      return { success: false, error: "Missing sessionId in context" };
    }

    const chatSession = await prisma.chatSession.findUnique({
      where: { id: context.sessionId },
    });

    if (!chatSession?.projectId) {
      return {
        success: false,
        error: "This session is not associated with any project. You cannot use this tool here.",
      };
    }

    try {
      await upsertProjectDocument(chatSession.projectId, args.content, {
        source: "agent",
        sessionId: context.sessionId,
      });
      return { success: true, message: "Successfully stored in project memory." };
    } catch (err: any) {
      return { success: false, error: `Failed to store: ${err.message}` };
    }
  },

  search_project_knowledge: async (
    args: { query: string; topK?: number },
    context?: any
  ) => {
    if (!context?.sessionId) {
      return { success: false, error: "Missing sessionId in context" };
    }

    const chatSession = await prisma.chatSession.findUnique({
      where: { id: context.sessionId },
    });

    if (!chatSession?.projectId) {
      return {
        success: false,
        error: "This session is not associated with any project. You cannot use this tool here.",
      };
    }

    try {
      const results = await searchProjectMemory(
        chatSession.projectId,
        args.query,
        args.topK ?? 3
      );

      if (!results || results.length === 0) {
        return "NOT_FOUND";
      }

      return {
        success: true,
        results: results.map((r: any) => r.text).join("\n\n---\n\n"),
      };
    } catch (err: any) {
      return { success: false, error: `Failed to search: ${err.message}` };
    }
  },
};
