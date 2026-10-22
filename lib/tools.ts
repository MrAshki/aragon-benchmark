import {
  AllowlistedToolName,
  ApprovalRecord,
  ExecutionResultRecord,
  OrderRecord,
  ToolCallTrace,
} from './schemas';
import { authorizeToolExecution, sanitizeUntrustedData, validateToolCallArgs } from './security';
import { DatabaseState, readDb, writeDb } from './store';

const SANDBOX_NOTICE =
  'SANDBOX_LEDGER_ONLY: State persisted in AgentOps database. No external payment processor or external email gateway was invoked.';

export interface ExecuteToolOptions {
  runId: string;
  ticketId: string;
  toolName: AllowlistedToolName;
  rawArgs: unknown;
  approvalsForRun?: ApprovalRecord[];
  referenceDateIso?: string;
  dbOverride?: DatabaseState;
}

export interface ExecuteToolResponse {
  ok: boolean;
  trace: ToolCallTrace;
  executionRecord?: ExecutionResultRecord;
  error?: string;
}

/**
 * Executes an allowlisted server-side tool with:
 * 1. Zod argument validation
 * 2. Authorization gate for financial/state-mutating operations
 * 3. Idempotency protection via `idempotencyKey` ledger
 * 4. Real database state mutation in sandbox mode
 */
export function executeBackendTool(options: ExecuteToolOptions): ExecuteToolResponse {
  const startTime = Date.now();
  const db = options.dbOverride || readDb();
  const { runId, ticketId, toolName, rawArgs } = options;

  // 1. Validate tool name and Zod schema
  const validation = validateToolCallArgs(toolName, rawArgs);
  if (!validation.valid || !validation.parsedArgs) {
    const latencyMs = Math.max(1, Date.now() - startTime);
    return {
      ok: false,
      error: validation.error || 'Invalid tool arguments',
      trace: {
        toolName,
        args: (typeof rawArgs === 'object' && rawArgs !== null ? rawArgs : {}) as Record<string, unknown>,
        output: { error: validation.error },
        status: 'error',
        latencyMs,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const args = validation.parsedArgs;
  const approvalsForRun =
    options.approvalsForRun || db.approvals.filter((a) => a.runId === runId || a.ticketId === ticketId);

  // 2. Check Idempotency Ledger first for mutating tools
  const idempotencyKey = typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined;
  if (idempotencyKey) {
    const existingExec = db.executionResults.find(
      (r) => r.idempotencyKey === idempotencyKey && r.toolName === toolName && r.status === 'executed_sandbox'
    );
    if (existingExec) {
      const latencyMs = Math.max(1, Date.now() - startTime);
      return {
        ok: true,
        executionRecord: existingExec,
        trace: {
          toolName,
          args,
          output: {
            ...existingExec.output,
            idempotentReplay: true,
            originalExecutionId: existingExec.id,
          },
          status: 'idempotent_cached',
          latencyMs,
          timestamp: new Date().toISOString(),
          idempotencyKey,
        },
      };
    }
  }

  // 3. Enforce Authorization Gate
  const authDecision = authorizeToolExecution({
    toolName,
    args,
    approvalsForRun,
  });

  if (!authDecision.authorized) {
    const latencyMs = Math.max(1, Date.now() - startTime);
    const blockedRecord: ExecutionResultRecord = {
      id: `EXEC-BLK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      idempotencyKey: idempotencyKey || `unauth-${Date.now()}`,
      runId,
      ticketId,
      toolName,
      args,
      output: { blockedReason: authDecision.reason },
      status: 'blocked_unauthorized',
      sandboxNotice: SANDBOX_NOTICE,
      createdAt: new Date().toISOString(),
    };
    db.executionResults.push(blockedRecord);
    if (!options.dbOverride) writeDb(db);

    return {
      ok: false,
      error: authDecision.reason,
      executionRecord: blockedRecord,
      trace: {
        toolName,
        args,
        output: { error: authDecision.reason },
        status: 'blocked',
        latencyMs,
        timestamp: new Date().toISOString(),
        idempotencyKey,
      },
    };
  }

  // 4. Execute Allowlisted Tool Logic
  let output: Record<string, unknown> = {};

  if (toolName === 'lookupOrder') {
    const orderId = String(args.orderId);
    const order = db.orders.find((o) => o.id === orderId) || null;
    output = order
      ? {
          found: true,
          order: {
            id: order.id,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            status: order.status,
            totalAmount: order.totalAmount,
            currency: order.currency,
            carrier: order.carrier,
            trackingNumber: order.trackingNumber,
            orderedAt: order.orderedAt,
            deliveredAt: order.deliveredAt,
            itemsSummary: order.itemsSummary,
            itemsSummaryFa: order.itemsSummaryFa,
            refundedAmount: order.refundedAmount,
          },
        }
      : { found: false, orderId };
  } else if (toolName === 'readTrackingHistory') {
    const orderId = String(args.orderId);
    const order = db.orders.find((o) => o.id === orderId);
    const events = order?.trackingEvents || [];
    const anomalies = events.filter((e) => Boolean(e.anomalyFlag)).map((e) => e.anomalyFlag!);
    output = {
      orderId,
      carrier: order?.carrier || 'Unknown',
      trackingNumber: order?.trackingNumber || 'N/A',
      events,
      anomaliesDetected: anomalies,
      hasDeliveryDiscrepancy: anomalies.length > 0,
    };
  } else if (toolName === 'checkRefundEligibility') {
    const orderId = String(args.orderId);
    const requestedAmount = Number(args.requestedAmount);
    const order = db.orders.find((o) => o.id === orderId);
    const refNow = options.referenceDateIso ? new Date(options.referenceDateIso) : new Date('2026-10-22T09:30:00.000Z');

    if (!order) {
      output = {
        eligible: false,
        daysSinceDelivery: null,
        maxAllowedDays: 30,
        reasonFa: 'سفارش مورد نظر در پایگاه داده یافت نشد.',
        reasonEn: 'Order not found in database.',
        requiresHumanApproval: false,
      };
    } else {
      const deliveredDate = order.deliveredAt ? new Date(order.deliveredAt) : null;
      const daysSinceDelivery = deliveredDate
        ? Math.floor((refNow.getTime() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const hasAnomaly = order.trackingEvents.some((e) => Boolean(e.anomalyFlag));
      const withinWindow = daysSinceDelivery <= 30;
      const amountValid = requestedAmount > 0 && requestedAmount <= order.totalAmount - order.refundedAmount;

      const eligible = withinWindow && amountValid;
      output = {
        eligible,
        daysSinceDelivery,
        maxAllowedDays: 30,
        hasCarrierAnomaly: hasAnomaly,
        requestedAmount,
        maxRefundableAmount: order.totalAmount - order.refundedAmount,
        reasonFa: eligible
          ? `واجد شرایط بازگشت وجه (${daysSinceDelivery} روز از زمان ثبت تحویل گذشته؛ سقف مجاز ۳۰ روز). نیازمند تایید اپراتور انسانی.`
          : `خارج از سیاست بازگشت وجه: ${daysSinceDelivery} روز از تاریخ تحویل گذشته است (سقف مجاز ۳۰ روز تقویمی در سیاست POL-REF-30).`,
        reasonEn: eligible
          ? `Eligible for refund consideration (${daysSinceDelivery} days since delivery scan; max window 30 days). Requires human operator approval.`
          : `Outside refund policy window: ${daysSinceDelivery} days elapsed since verified delivery (max 30 calendar days under POL-REF-30).`,
        requiresHumanApproval: eligible,
      };
    }
  } else if (toolName === 'issueSandboxRefund') {
    const orderId = String(args.orderId);
    const amount = Number(args.amount);
    const reason = String(args.reason);
    const order = db.orders.find((o) => o.id === orderId);

    if (!order) {
      return {
        ok: false,
        error: `Order ${orderId} not found`,
        trace: {
          toolName,
          args,
          output: { error: `Order ${orderId} not found` },
          status: 'error',
          latencyMs: Math.max(1, Date.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      };
    }

    order.refundedAmount = Number((order.refundedAmount + amount).toFixed(2));
    order.status = 'refunded';
    order.updatedAt = new Date().toISOString();

    output = {
      sandboxTransactionId: `SBX-REF-${orderId}-${Date.now().toString().slice(-6)}`,
      orderId,
      refundedAmount: amount,
      currency: order.currency,
      newOrderStatus: order.status,
      reason,
      approvedByGate: authDecision.matchedApprovalId,
      sandboxNotice: SANDBOX_NOTICE,
    };
  } else if (toolName === 'updateOrderStatus') {
    const orderId = String(args.orderId);
    const newStatus = args.newStatus as OrderRecord['status'];
    const note = String(args.note);
    const order = db.orders.find((o) => o.id === orderId);
    const previousStatus = order?.status || 'unknown';
    if (order) {
      order.status = newStatus;
      order.updatedAt = new Date().toISOString();
    }
    output = {
      orderId,
      previousStatus,
      newStatus,
      note,
      sandboxNotice: SANDBOX_NOTICE,
    };
  } else if (toolName === 'createReplyDraft') {
    const targetTicketId = String(args.ticketId);
    const subject = String(args.subject);
    const bodyFa = String(args.bodyFa);
    const bodyEn = String(args.bodyEn);
    const combinedContent = `[پیش‌نویس پاسخ سامانه / Sandbox Reply Draft — ${subject}]\n${bodyFa}\n---\n${bodyEn}`;
    const sanitized = sanitizeUntrustedData(combinedContent);

    db.messages.push({
      id: `MSG-DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      ticketId: targetTicketId,
      senderRole: 'agent',
      senderName: 'AgentOps Executor (Sandbox Draft)',
      content: combinedContent,
      sanitizedContent: sanitized.sanitized,
      injectionFlags: [],
      createdAt: new Date().toISOString(),
    });

    output = {
      draftId: `DRF-${targetTicketId}-${Date.now().toString().slice(-5)}`,
      ticketId: targetTicketId,
      recipientEmail: args.recipientEmail,
      subject,
      deliveryMode: 'SANDBOX_DRAFT_SAVED_ONLY',
      sandboxNotice: SANDBOX_NOTICE,
    };
  }

  const latencyMs = Math.max(2, Date.now() - startTime);
  let executionRecord: ExecutionResultRecord | undefined;

  if (idempotencyKey) {
    executionRecord = {
      id: `EXEC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      idempotencyKey,
      runId,
      ticketId,
      toolName,
      args,
      output,
      status: 'executed_sandbox',
      sandboxNotice: SANDBOX_NOTICE,
      createdAt: new Date().toISOString(),
    };
    db.executionResults.push(executionRecord);
  }

  if (!options.dbOverride) {
    writeDb(db);
  }

  return {
    ok: true,
    executionRecord,
    trace: {
      toolName,
      args,
      output,
      status: 'success',
      latencyMs,
      timestamp: new Date().toISOString(),
      idempotencyKey,
    },
  };
}
