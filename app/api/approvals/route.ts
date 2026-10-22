import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resumeWorkflowAfterApproval } from '@/lib/orchestrator';
import { computeMeasuredMetrics, readDb } from '@/lib/store';

const ApprovalActionSchema = z.object({
  approvalId: z.string().min(3).max(128),
  decision: z.enum(['approved', 'rejected']),
  reviewerNote: z.string().max(1000).optional(),
  reviewedBy: z.string().max(128).optional(),
});

export async function GET() {
  const db = readDb();
  return NextResponse.json({
    ok: true,
    approvals: db.approvals,
  });
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = ApprovalActionSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
        { status: 400 }
      );
    }

    const result = resumeWorkflowAfterApproval(parsed.data);
    const db = readDb();

    return NextResponse.json({
      ok: true,
      ...result,
      db,
      metrics: computeMeasuredMetrics(db),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Approval resolution failed' },
      { status: 500 }
    );
  }
}
