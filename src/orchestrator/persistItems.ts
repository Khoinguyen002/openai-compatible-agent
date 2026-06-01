import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { PendingContextItem } from "./toolWrapper.js";
import { childLogger } from "../logger.js";

export async function persistItems(
  sessionId: string,
  senderUserId: bigint,
  items: PendingContextItem[],
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
          content: item.content ?? null,
          reasoning: item.reasoning ?? null,
          toolCalls: item.toolCalls ? JSON.stringify(item.toolCalls) : null,
          toolCallId: item.toolCallId ?? null,
        },
      });
    }
  });

  reqLog.debug({ itemCount: items.length }, "context items persisted");
}
