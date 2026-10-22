import { NextResponse } from 'next/server';
import { testJevConnection } from '@/lib/decision-engine';

export async function GET() {
  try {
    const result = await testJevConnection();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Jev connection test failed',
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
