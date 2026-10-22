import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { compareAllRouters } from '@/lib/decision-engine';

const CompareInputSchema = z.object({
  subject: z.string().min(2).max(300),
  message: z.string().min(3).max(4000),
  orderId: z.string().max(64).optional(),
  forceDemo: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = CompareInputSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
        { status: 400 }
      );
    }

    const comparison = await compareAllRouters(parsed.data);
    return NextResponse.json({
      ok: true,
      comparison,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Decision Lab comparison failed' },
      { status: 500 }
    );
  }
}
