import { NextRequest, NextResponse } from 'next/server';
import { AllowlistedToolName } from '@/lib/schemas';
import { computeMeasuredMetrics, readDb } from '@/lib/store';
import { executeBackendTool } from '@/lib/tools';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { runId, ticketId, toolName, args } = body;

    const result = executeBackendTool({
      runId: String(runId || 'MANUAL-INSPECT'),
      ticketId: String(ticketId || 'TCK-1001'),
      toolName: toolName as AllowlistedToolName,
      rawArgs: args,
    });

    const db = readDb();
    return NextResponse.json({
      ok: result.ok,
      trace: result.trace,
      executionRecord: result.executionRecord,
      error: result.error,
      db,
      metrics: computeMeasuredMetrics(db),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Tool execution failed' },
      { status: 500 }
    );
  }
}
