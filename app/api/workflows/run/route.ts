import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeTicketWorkflow } from '@/lib/orchestrator';
import { computeMeasuredMetrics, readDb, writeDb } from '@/lib/store';

const RunWorkflowSchema = z.object({
  ticketId: z.string().min(3).max(64),
  forceDemo: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = RunWorkflowSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid ticketId parameter' },
        { status: 400 }
      );
    }

    const db = readDb();
    // Reset order status if re-running TCK-1001 so the user can test the full approval lifecycle repeatedly
    if (parsed.data.ticketId === 'TCK-1001') {
      const ord = db.orders.find((o) => o.id === 'ORD-8841');
      if (ord) {
        ord.status = 'delivered';
        ord.refundedAmount = 0;
      }
    }

    const result = await executeTicketWorkflow({
      ticketId: parsed.data.ticketId,
      forceDemo: parsed.data.forceDemo ?? true,
      dbOverride: db,
    });
    writeDb(db);

    return NextResponse.json({
      ok: true,
      ...result,
      db,
      metrics: computeMeasuredMetrics(db),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Workflow execution failed' },
      { status: 500 }
    );
  }
}
