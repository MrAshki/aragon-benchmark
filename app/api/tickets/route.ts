import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeTicketWorkflow } from '@/lib/orchestrator';
import { TicketCategorySchema, TicketUrgencySchema } from '@/lib/schemas';
import { sanitizeUntrustedData } from '@/lib/security';
import { computeMeasuredMetrics, readDb, writeDb } from '@/lib/store';

const CreateTicketInputSchema = z.object({
  orderId: z.string().min(3).max(64),
  subject: z.string().min(3).max(300),
  customerName: z.string().min(2).max(120),
  customerEmail: z.string().email(),
  category: TicketCategorySchema.optional(),
  priority: TicketUrgencySchema.optional(),
  message: z.string().min(5).max(4000),
  scenarioId: z.string().max(64).optional(),
  autoRunWorkflow: z.boolean().optional(),
  forceDemo: z.boolean().optional(),
});

export async function GET() {
  const db = readDb();
  return NextResponse.json({
    ok: true,
    tickets: db.tickets,
    messages: db.messages,
  });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = CreateTicketInputSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const db = readDb();
    const ticketId = `TCK-${Math.floor(1004 + db.tickets.length + Math.random() * 900)}`;
    const now = new Date().toISOString();
    const sanitizedMsg = sanitizeUntrustedData(input.message);

    const newTicket = {
      id: ticketId,
      orderId: input.orderId,
      subject: input.subject,
      SubjectEn: input.subject,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      category: input.category || 'refund_request',
      status: 'open' as const,
      priority: input.priority || 'medium',
      scenarioId: input.scenarioId || 'custom_submission',
      latestRunId: null,
      createdAt: now,
      updatedAt: now,
    };

    const newMsg = {
      id: `MSG-${ticketId}-1`,
      ticketId,
      senderRole: 'customer' as const,
      senderName: input.customerName,
      content: input.message,
      sanitizedContent: sanitizedMsg.sanitized,
      injectionFlags: sanitizedMsg.findings,
      createdAt: now,
    };

    db.tickets.unshift(newTicket);
    db.messages.push(newMsg);
    writeDb(db);

    let workflowResult = null;
    if (input.autoRunWorkflow !== false) {
      workflowResult = await executeTicketWorkflow({
        ticketId,
        forceDemo: input.forceDemo ?? true,
        dbOverride: db,
      });
      writeDb(db);
    }

    return NextResponse.json({
      ok: true,
      ticket: newTicket,
      message: newMsg,
      workflowResult,
      db,
      metrics: computeMeasuredMetrics(db),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Ticket creation failed' },
      { status: 500 }
    );
  }
}
