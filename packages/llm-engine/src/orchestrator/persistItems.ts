import { Prisma } from "@prisma/client";
import { prisma } from "@workspace/db";
import { childLogger } from "@workspace/core";
import { NonStreamingChoice, ToolMessage, UserMessage } from "./types/index.js";

export async function persistItems(
  sessionId: string,
  senderUserId: bigint,
  items: (NonStreamingChoice["message"] | ToolMessage | UserMessage)[],
  reqLog: ReturnType<typeof childLogger>,
): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const maxSeqResult = await tx.contextItem.aggregate({
      where: { sessionId },
      _max: { sequence: true },
    });
    let seq = (maxSeqResult._max.sequence ?? -1) + 1;

    for (const item of items) {
      await tx.contextItem.create({
        data: {
          sessionId,
          sequence: seq++,
          role: item.role,
          senderUserId: item.role === "user" ? senderUserId : null,
          content: (item.content as string) ?? null,
          reasoning: (item as NonStreamingChoice["message"]).reasoning ?? null,
          toolCalls: (item as NonStreamingChoice["message"]).tool_calls
            ? JSON.stringify((item as NonStreamingChoice["message"]).tool_calls)
            : null,
          toolCallId: (item as ToolMessage).tool_call_id ?? null,
        },
      });
    }
  });

  reqLog.debug({ itemCount: items.length }, "context items persisted");
}
