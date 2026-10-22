import { NextRequest, NextResponse } from 'next/server';
import { executeTicketWorkflow } from '@/lib/orchestrator';
import { computeMeasuredMetrics, readDb, resetDbToSeed, writeDb } from '@/lib/store';

let bootstrapped = false;

async function ensureBootstrapped() {
  const db = readDb();
  if (!bootstrapped && db.workflowRuns.length === 0) {
    bootstrapped = true;
    // Execute the 3 ready-to-run scenarios so initial dashboard metrics, timeline traces,
    // and the pending human approval inbox are populated from real graph executions.
    for (const ticketId of ['TCK-1003', 'TCK-1002', 'TCK-1001']) {
      await executeTicketWorkflow({ ticketId, forceDemo: true, dbOverride: db });
    }
    writeDb(db);
  }
  return db;
}

export async function GET() {
  try {
    const db = await ensureBootstrapped();
    const metrics = computeMeasuredMetrics(db);
    const hasGeminiKey = Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
        process.env.GEMINI_API_KEY.trim().length > 10
    );
    const hasJevKey = Boolean(process.env.JEV_API_KEY && process.env.JEV_API_KEY.trim().length > 5);

    return NextResponse.json({
      ok: true,
      db,
      metrics,
      capabilities: {
        hasGeminiKey,
        hasJevKey,
        defaultMode: hasGeminiKey ? 'live_ai' : 'demo_deterministic',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load state' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.action === 'reset_seed') {
      const db = resetDbToSeed();
      for (const ticketId of ['TCK-1003', 'TCK-1002', 'TCK-1001']) {
        await executeTicketWorkflow({ ticketId, forceDemo: true, dbOverride: db });
      }
      writeDb(db);
      return NextResponse.json({
        ok: true,
        db,
        metrics: computeMeasuredMetrics(db),
      });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'State operation failed' },
      { status: 500 }
    );
  }
}
