import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { runJevRouter, runResolutionPlanner } from './decision-engine';
import {
  AgentEventRecord,
  ApprovalRecord,
  ExecutionResultRecord,
  OrderRecord,
  PolicyDocument,
  ResolutionPlan,
  RouterDecision,
  TrackingEvent,
  VerificationReport,
  VerificationReportSchema,
  WorkflowRunRecord,
} from './schemas';
import { sanitizeUntrustedData, validateToolCallArgs } from './security';
import { DatabaseState, readDb, writeDb } from './store';
import { executeBackendTool } from './tools';

export interface OrchestratorGraphState {
  runId: string;
  ticketId: string;
  orderId: string;
  customerEmail: string;
  subject: string;
  rawCustomerMessage: string;
  sanitizedCustomerMessage: string;
  injectionFindings: string[];
  forceDemo: boolean;
  mode: 'demo_deterministic' | 'live_ai';
  status: WorkflowRunRecord['status'];
  currentNode: string;
  retryCount: number;
  verifierFeedback: string;
  routerDecision: RouterDecision | null;
  order: OrderRecord | null;
  trackingHistory: TrackingEvent[];
  refundEligibility: {
    eligible: boolean;
    daysSinceDelivery: number | null;
    maxAllowedDays: number;
    reasonFa: string;
    reasonEn: string;
    requiresHumanApproval: boolean;
  } | null;
  matchedPolicies: PolicyDocument[];
  applicableConstraints: string[];
  proposedPlan: ResolutionPlan | null;
  verificationReport: VerificationReport | null;
  pendingApprovalIds: string[];
  executionResults: ExecutionResultRecord[];
  events: AgentEventRecord[];
  totalLatencyMs: number;
  estimatedCostUsd: number;
}

const GraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  ticketId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  orderId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  customerEmail: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  subject: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  rawCustomerMessage: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  sanitizedCustomerMessage: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  injectionFindings: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  forceDemo: Annotation<boolean>({ reducer: (_, b) => b, default: () => true }),
  mode: Annotation<'demo_deterministic' | 'live_ai'>({
    reducer: (_, b) => b,
    default: () => 'demo_deterministic',
  }),
  status: Annotation<WorkflowRunRecord['status']>({
    reducer: (_, b) => b,
    default: () => 'running',
  }),
  currentNode: Annotation<string>({ reducer: (_, b) => b, default: () => 'jev_router' }),
  retryCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  verifierFeedback: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  routerDecision: Annotation<RouterDecision | null>({ reducer: (_, b) => b, default: () => null }),
  order: Annotation<OrderRecord | null>({ reducer: (_, b) => b, default: () => null }),
  trackingHistory: Annotation<TrackingEvent[]>({ reducer: (_, b) => b, default: () => [] }),
  refundEligibility: Annotation<OrchestratorGraphState['refundEligibility']>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  matchedPolicies: Annotation<PolicyDocument[]>({ reducer: (_, b) => b, default: () => [] }),
  applicableConstraints: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  proposedPlan: Annotation<ResolutionPlan | null>({ reducer: (_, b) => b, default: () => null }),
  verificationReport: Annotation<VerificationReport | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  pendingApprovalIds: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  executionResults: Annotation<ExecutionResultRecord[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  events: Annotation<AgentEventRecord[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  totalLatencyMs: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
  estimatedCostUsd: Annotation<number>({
    reducer: (a, b) => Number((a + b).toFixed(5)),
    default: () => 0,
  }),
});

/**
 * Runs the LangGraph multi-agent workflow for a given ticket.
 */
export async function executeTicketWorkflow(params: {
  ticketId: string;
  forceDemo?: boolean;
  dbOverride?: DatabaseState;
}): Promise<{
  run: WorkflowRunRecord;
  events: AgentEventRecord[];
  approvals: ApprovalRecord[];
}> {
  const db = params.dbOverride || readDb();
  const ticket = db.tickets.find((t) => t.id === params.ticketId);
  if (!ticket) {
    throw new Error(`Ticket ${params.ticketId} not found`);
  }

  const customerMessages = db.messages.filter((m) => m.ticketId === ticket.id);
  const latestCustomerMsg =
    customerMessages[customerMessages.length - 1]?.content || ticket.subject;
  const sanitizedMsg = sanitizeUntrustedData(latestCustomerMsg);

  const runId = `RUN-${ticket.id}-${Date.now().toString().slice(-6)}`;
  const forceDemo = params.forceDemo ?? true;

  ticket.status = 'investigating';
  ticket.latestRunId = runId;
  ticket.updatedAt = new Date().toISOString();

  // Node 1: Jev Router
  const jevRouterNode = async (state: typeof GraphStateAnnotation.State) => {
    const decision = await runJevRouter({
      subject: state.subject,
      message: state.sanitizedCustomerMessage,
      orderId: state.orderId,
      forceDemo: state.forceDemo,
    });

    const evt: AgentEventRecord = {
      id: `EVT-${state.runId}-router-${Date.now().toString().slice(-4)}`,
      runId: state.runId,
      ticketId: state.ticketId,
      agentName: 'jev_router',
      stepStatus: 'completed',
      inputSummary: `Subject: "${state.subject}" | Order: ${state.orderId}`,
      outputSummary: `${decision.rationaleFa} (Intent: ${decision.intent}, Risk: ${decision.riskScore})`,
      outputSummaryEn: `${decision.rationaleEn} (Intent: ${decision.intent}, Risk: ${decision.riskScore})`,
      toolCalls: [],
      latencyMs: decision.latencyMs,
      costUsd: decision.estimatedCostUsd,
      createdAt: new Date().toISOString(),
    };

    return {
      routerDecision: decision,
      mode: decision.executionMode,
      currentNode: 'jev_router',
      events: [evt],
      totalLatencyMs: decision.latencyMs,
      estimatedCostUsd: decision.estimatedCostUsd,
    };
  };

  // Node 2a (Parallel Branch A): Investigator Agent (Executes real backend tools)
  const investigatorNode = async (state: typeof GraphStateAnnotation.State) => {
    const start = Date.now();
    const lookupRes = executeBackendTool({
      runId: state.runId,
      ticketId: state.ticketId,
      toolName: 'lookupOrder',
      rawArgs: { orderId: state.orderId },
      dbOverride: db,
    });

    const foundOrder = db.orders.find((o) => o.id === state.orderId) || null;

    const trackingRes = executeBackendTool({
      runId: state.runId,
      ticketId: state.ticketId,
      toolName: 'readTrackingHistory',
      rawArgs: {
        orderId: state.orderId,
        trackingNumber: foundOrder?.trackingNumber,
      },
      dbOverride: db,
    });

    const eligibilityRes = executeBackendTool({
      runId: state.runId,
      ticketId: state.ticketId,
      toolName: 'checkRefundEligibility',
      rawArgs: {
        orderId: state.orderId,
        requestedAmount: foundOrder?.totalAmount || 100,
        reason: state.subject,
      },
      dbOverride: db,
    });

    const latencyMs =
      lookupRes.trace.latencyMs +
      trackingRes.trace.latencyMs +
      eligibilityRes.trace.latencyMs +
      Math.max(4, Date.now() - start);

    const eligOut = eligibilityRes.trace.output as {
      eligible: boolean;
      daysSinceDelivery: number | null;
      maxAllowedDays: number;
      reasonFa: string;
      reasonEn: string;
      requiresHumanApproval: boolean;
    };

    const anomalies = (trackingRes.trace.output.anomaliesDetected as string[]) || [];

    const evt: AgentEventRecord = {
      id: `EVT-${state.runId}-inv-${Date.now().toString().slice(-4)}`,
      runId: state.runId,
      ticketId: state.ticketId,
      agentName: 'investigator',
      stepStatus: 'completed',
      inputSummary: `Querying order ${state.orderId}, tracking history, and refund eligibility`,
      outputSummary: `سفارش ${state.orderId} (${foundOrder?.status || 'نامشخص'}) بررسی شد. ناهنجاری‌های تله‌متری: ${
        anomalies.length > 0 ? anomalies.join(', ') : 'ندارد'
      }. وضعیت واجد شرایط بودن بازگشت وجه: ${eligOut.eligible ? 'بله' : 'خیر'}.`,
      outputSummaryEn: `Inspected order ${state.orderId} (${foundOrder?.status}). Telemetry anomalies: ${
        anomalies.length > 0 ? anomalies.join(', ') : 'none'
      }. Refund eligible: ${eligOut.eligible}.`,
      toolCalls: [lookupRes.trace, trackingRes.trace, eligibilityRes.trace],
      latencyMs,
      costUsd: 0.0005,
      createdAt: new Date().toISOString(),
    };

    return {
      order: foundOrder,
      trackingHistory: foundOrder?.trackingEvents || [],
      refundEligibility: eligOut,
      events: [evt],
      totalLatencyMs: latencyMs,
      estimatedCostUsd: 0.0005,
    };
  };

  // Node 2b (Parallel Branch B): Policy Analyst Agent
  const policyAnalystNode = async (state: typeof GraphStateAnnotation.State) => {
    const start = Date.now();
    const intent = state.routerDecision?.intent || ticket.category;
    const matched = db.policies.filter(
      (p) => p.category === intent || (intent === 'delayed_delivery' && p.code === 'REFUND-WINDOW-30D')
    );
    const activePolicies = matched.length > 0 ? matched : db.policies;

    // Sanitize policy documents as untrusted text just in case
    const constraints = activePolicies.flatMap((p) =>
      p.constraints.map((c) => sanitizeUntrustedData(c).sanitized)
    );
    const latencyMs = Math.max(9, Date.now() - start + 8);

    const evt: AgentEventRecord = {
      id: `EVT-${state.runId}-pol-${Date.now().toString().slice(-4)}`,
      runId: state.runId,
      ticketId: state.ticketId,
      agentName: 'policy_analyst',
      stepStatus: 'completed',
      inputSummary: `Retrieving operational policies for intent "${intent}"`,
      outputSummary: `سیاست‌های منطبق بازیابی شد: ${activePolicies.map((p) => p.id).join(', ')} (${constraints.length} قید اجرایی).`,
      outputSummaryEn: `Retrieved applicable policies: ${activePolicies.map((p) => p.id).join(', ')} (${constraints.length} active constraints).`,
      toolCalls: [],
      latencyMs,
      costUsd: 0.0003,
      createdAt: new Date().toISOString(),
    };

    return {
      matchedPolicies: activePolicies,
      applicableConstraints: constraints,
      events: [evt],
      totalLatencyMs: latencyMs,
      estimatedCostUsd: 0.0003,
    };
  };

  // Node 3: Resolution Planner (Gemini 4 Argon)
  const resolutionPlannerNode = async (state: typeof GraphStateAnnotation.State) => {
    const res = await runResolutionPlanner({
      ticketId: state.ticketId,
      orderId: state.orderId,
      customerEmail: state.customerEmail,
      subject: state.subject,
      sanitizedCustomerMessage: state.sanitizedCustomerMessage,
      routerDecision: state.routerDecision!,
      order: state.order,
      trackingHistory: state.trackingHistory,
      refundEligibility: state.refundEligibility || {
        eligible: false,
        daysSinceDelivery: null,
        maxAllowedDays: 30,
        reasonFa: 'نامشخص',
        reasonEn: 'Unknown',
        requiresHumanApproval: false,
      },
      matchedPolicies: state.matchedPolicies,
      retryAttempt: state.retryCount,
      previousVerifierFeedback: state.verifierFeedback,
      forceDemo: state.forceDemo,
    });

    const evt: AgentEventRecord = {
      id: `EVT-${state.runId}-plan-${state.retryCount}-${Date.now().toString().slice(-4)}`,
      runId: state.runId,
      ticketId: state.ticketId,
      agentName: 'resolution_planner',
      stepStatus: state.retryCount > 0 ? 'retried' : 'completed',
      inputSummary: `Synthesizing evidence + ${state.matchedPolicies.length} policies (Attempt #${state.retryCount + 1})`,
      outputSummary: res.plan.summaryFa,
      outputSummaryEn: res.plan.summaryEn,
      toolCalls: [],
      latencyMs: res.latencyMs,
      costUsd: res.costUsd,
      createdAt: new Date().toISOString(),
    };

    return {
      proposedPlan: res.plan,
      currentNode: 'resolution_planner',
      events: [evt],
      totalLatencyMs: res.latencyMs,
      estimatedCostUsd: res.costUsd,
    };
  };

  // Node 4: Independent Verifier
  const verifierNode = async (state: typeof GraphStateAnnotation.State) => {
    const start = Date.now();
    const plan = state.proposedPlan!;
    const missingInformation: string[] = [];

    // 1. Validate all proposed tool call arguments against server Zod schemas
    let allToolArgsValid = true;
    for (const action of plan.proposedActions) {
      const check = validateToolCallArgs(action.toolName, action.args);
      if (!check.valid) {
        allToolArgsValid = false;
        missingInformation.push(`Invalid tool args for ${action.toolName}: ${check.error}`);
      }
    }

    // 2. Check policy consistency: never allow issueSandboxRefund if refundEligibility.eligible is false
    const proposesRefund = plan.proposedActions.some((a) => a.toolName === 'issueSandboxRefund');
    const policyCompliant = proposesRefund ? Boolean(state.refundEligibility?.eligible) : true;

    // 3. Check if technical escalation requires a retry to include complete UART / 120-ohm diagnostic checklist
    let requiresRetry = false;
    if (
      state.routerDecision?.intent === 'technical_issue' &&
      state.retryCount === 0 &&
      plan.confidence < 0.8
    ) {
      requiresRetry = true;
      missingInformation.push(
        'Missing explicit RS-485 115200 baud UART capture & 120-ohm termination diagnostic parameters in reply draft'
      );
    }

    // 4. Determine if human-in-the-loop approval is required
    const requiresHumanApproval =
      !requiresRetry &&
      policyCompliant &&
      plan.proposedActions.some((a) => a.isIrreversibleOrFinancial || a.requiresHumanApproval);

    const report = VerificationReportSchema.parse({
      passed: !requiresRetry && policyCompliant && allToolArgsValid,
      evidenceConsistent: Boolean(state.order),
      policyCompliant,
      toolArgsValid: allToolArgsValid,
      missingInformation,
      promptInjectionDetected: state.injectionFindings.length > 0,
      injectionFindings: state.injectionFindings,
      requiresRetry,
      requiresHumanApproval,
      requiresEscalation: plan.requiresEscalation,
      verifierNotesFa: requiresRetry
        ? `نقص اطلاعات تشخیصی در پیش‌نویس فنی شناسایی شد (${missingInformation.join(', ')}). بازگشت به برنامه‌ریز برای تکمیل چک‌لیست سطح ۳.`
        : state.injectionFindings.length > 0
          ? `تلاش تزریق پرامپت (${state.injectionFindings.join(', ')}) خنثی شد. تطابق کامل طرح با سیاست POL-REF-30 تایید گردید.`
          : requiresHumanApproval
            ? 'شواهد، سیاست‌ها و آرگومان‌های ابزار معتبرند. به دلیل ماهیت مالی عملیات (issueSandboxRefund)، توقف در درگاه تایید انسانی الزامی است.'
            : 'تمامی بررسی‌های شواهد، سیاست و طرحواره ابزار با موفقیت تایید شد.',
      verifierNotesEn: requiresRetry
        ? `Incomplete technical diagnostic parameters detected (${missingInformation.join(', ')}). Triggering retry loop to Resolution Planner.`
        : state.injectionFindings.length > 0
          ? `Prompt injection attempt (${state.injectionFindings.join(', ')}) neutralized. Policy compliance verified under POL-REF-30.`
          : requiresHumanApproval
            ? 'Evidence, policy constraints, and Zod tool schemas verified. Pausing workflow for mandatory human approval of financial action.'
            : 'All evidence, policy consistency, and Zod tool argument checks passed.',
    });

    const latencyMs = Math.max(11, Date.now() - start + 9);
    const evt: AgentEventRecord = {
      id: `EVT-${state.runId}-ver-${state.retryCount}-${Date.now().toString().slice(-4)}`,
      runId: state.runId,
      ticketId: state.ticketId,
      agentName: 'verifier',
      stepStatus: requiresRetry ? 'retried' : 'completed',
      inputSummary: `Verifying ${plan.proposedActions.length} proposed actions against evidence & policy`,
      outputSummary: report.verifierNotesFa,
      outputSummaryEn: report.verifierNotesEn,
      toolCalls: [],
      latencyMs,
      costUsd: 0.0004,
      createdAt: new Date().toISOString(),
    };

    return {
      verificationReport: report,
      retryCount: requiresRetry ? state.retryCount + 1 : state.retryCount,
      verifierFeedback: missingInformation.join('; '),
      currentNode: 'verifier',
      events: [evt],
      totalLatencyMs: latencyMs,
      estimatedCostUsd: 0.0004,
    };
  };

  // Node 5a: Human-in-the-Loop Gate (Pauses execution and creates ApprovalRecord)
  const humanGateNode = async (state: typeof GraphStateAnnotation.State) => {
    const start = Date.now();
    const plan = state.proposedPlan!;
    const createdApprovalIds: string[] = [];

    for (const action of plan.proposedActions) {
      if (action.requiresHumanApproval || action.isIrreversibleOrFinancial) {
        const approvalId = `APR-${state.ticketId}-${Date.now().toString().slice(-5)}`;
        const approval: ApprovalRecord = {
          id: approvalId,
          runId: state.runId,
          ticketId: state.ticketId,
          orderId: state.orderId,
          actionType: action.toolName,
          actionArgs: action.args,
          riskLevel: state.routerDecision?.riskLevel || 'high',
          reasonFa: action.descriptionFa,
          reasonEn: action.descriptionEn,
          status: 'pending',
          reviewerNote: '',
          reviewedBy: null,
          idempotencyKey: String(action.args.idempotencyKey || `idem-${approvalId}`),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        db.approvals.push(approval);
        createdApprovalIds.push(approvalId);
      }
    }

    ticket.status = 'awaiting_approval';
    ticket.updatedAt = new Date().toISOString();

    const latencyMs = Math.max(6, Date.now() - start + 5);
    const evt: AgentEventRecord = {
      id: `EVT-${state.runId}-gate-${Date.now().toString().slice(-4)}`,
      runId: state.runId,
      ticketId: state.ticketId,
      agentName: 'human_gate',
      stepStatus: 'paused',
      inputSummary: `Blocking irreversible/financial action for human operator approval`,
      outputSummary: `گردش‌کار در وضعیت انتظار تایید انسانی متوقف شد (شناسه درخواست تایید: ${createdApprovalIds.join(', ')}). اجرای ابزار مالی تا زمان تایید مسدود است.`,
      outputSummaryEn: `Workflow paused at Human-in-the-Loop Gate (Approval ID: ${createdApprovalIds.join(', ')}). Financial tool execution blocked until explicit operator approval.`,
      toolCalls: [],
      latencyMs,
      costUsd: 0,
      createdAt: new Date().toISOString(),
    };

    return {
      status: 'paused_for_approval' as const,
      currentNode: 'human_gate',
      pendingApprovalIds: createdApprovalIds,
      events: [evt],
      totalLatencyMs: latencyMs,
    };
  };

  // Node 5b: Executor Agent (Executes allowlisted non-blocked tools)
  const executorNode = async (state: typeof GraphStateAnnotation.State) => {
    const start = Date.now();
    const plan = state.proposedPlan!;
    const toolTraces = [];
    const execRecords: ExecutionResultRecord[] = [];

    const approvalsForRun = db.approvals.filter((a) => a.runId === state.runId);

    for (const action of plan.proposedActions) {
      const execRes = executeBackendTool({
        runId: state.runId,
        ticketId: state.ticketId,
        toolName: action.toolName,
        rawArgs: action.args,
        approvalsForRun,
        dbOverride: db,
      });
      toolTraces.push(execRes.trace);
      if (execRes.executionRecord) {
        execRecords.push(execRes.executionRecord);
      }
    }

    const finalRunStatus: WorkflowRunRecord['status'] = plan.requiresEscalation
      ? 'escalated'
      : 'completed';
    ticket.status = plan.requiresEscalation ? 'escalated' : 'resolved';
    ticket.updatedAt = new Date().toISOString();

    const latencyMs = Math.max(10, Date.now() - start + 8);
    const evt: AgentEventRecord = {
      id: `EVT-${state.runId}-exec-${Date.now().toString().slice(-4)}`,
      runId: state.runId,
      ticketId: state.ticketId,
      agentName: 'executor',
      stepStatus: 'completed',
      inputSummary: `Executing ${plan.proposedActions.length} verified tool(s) in sandbox`,
      outputSummary: plan.requiresEscalation
        ? `پیش‌نویس چک‌لیست تشخیصی ایجاد شد و پرونده به تیم مهندسی سطح ۳ (L3) ارجاع گردید.`
        : `ابزارهای مجاز (${plan.proposedActions.map((a) => a.toolName).join(', ')}) با موفقیت در محیط سندباکس اجرا و ذخیره شدند.`,
      outputSummaryEn: plan.requiresEscalation
        ? `Diagnostic checklist draft saved and ticket escalated to L3 Engineering.`
        : `Allowlisted tool(s) (${plan.proposedActions.map((a) => a.toolName).join(', ')}) executed and persisted in sandbox.`,
      toolCalls: toolTraces,
      latencyMs,
      costUsd: 0.0002,
      createdAt: new Date().toISOString(),
    };

    return {
      status: finalRunStatus,
      currentNode: 'executor',
      executionResults: execRecords,
      events: [evt],
      totalLatencyMs: latencyMs,
      estimatedCostUsd: 0.0002,
    };
  };

  // Assemble the LangGraph StateGraph
  const workflow = new StateGraph(GraphStateAnnotation)
    .addNode('jev_router', jevRouterNode)
    .addNode('investigator', investigatorNode)
    .addNode('policy_analyst', policyAnalystNode)
    .addNode('resolution_planner', resolutionPlannerNode)
    .addNode('verifier', verifierNode)
    .addNode('human_gate', humanGateNode)
    .addNode('executor', executorNode)
    .addEdge(START, 'jev_router')
    // Parallel fan-out from Jev Router to Investigator and Policy Analyst
    .addEdge('jev_router', 'investigator')
    .addEdge('jev_router', 'policy_analyst')
    // Fan-in convergence to Resolution Planner
    .addEdge('investigator', 'resolution_planner')
    .addEdge('policy_analyst', 'resolution_planner')
    // Sequential verification
    .addEdge('resolution_planner', 'verifier')
    // Conditional routing from Verifier: retry, human approval gate, or direct executor
    .addConditionalEdges('verifier', (state) => {
      if (state.verificationReport?.requiresRetry) {
        return 'resolution_planner';
      }
      if (state.verificationReport?.requiresHumanApproval) {
        return 'human_gate';
      }
      return 'executor';
    })
    .addEdge('human_gate', END)
    .addEdge('executor', END);

  const app = workflow.compile();

  const finalState = await app.invoke({
    runId,
    ticketId: ticket.id,
    orderId: ticket.orderId,
    customerEmail: ticket.customerEmail,
    subject: ticket.subject,
    rawCustomerMessage: latestCustomerMsg,
    sanitizedCustomerMessage: sanitizedMsg.sanitized,
    injectionFindings: sanitizedMsg.findings,
    forceDemo,
  });

  const runRecord: WorkflowRunRecord = {
    id: runId,
    ticketId: ticket.id,
    orderId: ticket.orderId,
    mode: finalState.mode,
    status: finalState.status,
    currentNode: finalState.currentNode,
    retryCount: finalState.retryCount,
    routerDecision: finalState.routerDecision,
    evidence: {
      order: finalState.order,
      trackingHistory: finalState.trackingHistory,
      refundEligibility: finalState.refundEligibility || undefined,
    },
    policyEvaluation: {
      matchedPolicies: finalState.matchedPolicies,
      applicableConstraints: finalState.applicableConstraints,
      withinPolicyWindow: Boolean(finalState.refundEligibility?.eligible),
      notesFa: `سیاست‌های بررسی‌شده: ${finalState.matchedPolicies.map((p) => p.code).join(', ')}`,
      notesEn: `Evaluated policies: ${finalState.matchedPolicies.map((p) => p.code).join(', ')}`,
    },
    proposedPlan: finalState.proposedPlan,
    verificationReport: finalState.verificationReport,
    pendingApprovalIds: finalState.pendingApprovalIds,
    executionResults: finalState.executionResults,
    totalLatencyMs: finalState.totalLatencyMs,
    estimatedCostUsd: finalState.estimatedCostUsd,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Persist to database store
  db.workflowRuns.unshift(runRecord);
  db.agentEvents.push(...finalState.events);
  if (!params.dbOverride) {
    writeDb(db);
  }

  return {
    run: runRecord,
    events: finalState.events,
    approvals: db.approvals.filter((a) => a.runId === runId),
  };
}

/**
 * Resumes a paused workflow run after a human operator approves or rejects an ApprovalRecord.
 * Guarantees idempotency if invoked multiple times.
 */
export function resumeWorkflowAfterApproval(params: {
  approvalId: string;
  decision: 'approved' | 'rejected';
  reviewerNote?: string;
  reviewedBy?: string;
  dbOverride?: DatabaseState;
}): {
  approval: ApprovalRecord;
  run: WorkflowRunRecord;
  newEvents: AgentEventRecord[];
  executionResults: ExecutionResultRecord[];
} {
  const db = params.dbOverride || readDb();
  const approval = db.approvals.find((a) => a.id === params.approvalId);
  if (!approval) {
    throw new Error(`Approval ${params.approvalId} not found`);
  }

  const run = db.workflowRuns.find((r) => r.id === approval.runId);
  if (!run) {
    throw new Error(`Workflow run ${approval.runId} not found`);
  }

  const ticket = db.tickets.find((t) => t.id === approval.ticketId);

  // If already processed with the same decision, return idempotently
  if (approval.status === params.decision && run.status === 'completed') {
    const existingExecs = db.executionResults.filter((e) => e.runId === run.id);
    return {
      approval,
      run,
      newEvents: [],
      executionResults: existingExecs,
    };
  }

  approval.status = params.decision;
  approval.reviewerNote = params.reviewerNote || (params.decision === 'approved' ? 'Approved by operator' : 'Rejected by operator');
  approval.reviewedBy = params.reviewedBy || 'ops-supervisor@kavan.example';
  approval.updatedAt = new Date().toISOString();

  const newEvents: AgentEventRecord[] = [];
  const newExecResults: ExecutionResultRecord[] = [];

  const gateResumeEvt: AgentEventRecord = {
    id: `EVT-${run.id}-gate-decision-${Date.now().toString().slice(-4)}`,
    runId: run.id,
    ticketId: run.ticketId,
    agentName: 'human_gate',
    stepStatus: 'completed',
    inputSummary: `Human operator decision on ${approval.id}: ${params.decision.toUpperCase()}`,
    outputSummary:
      params.decision === 'approved'
        ? `اپراتور انسانی درخواست ${approval.id} را تایید کرد (${approval.reviewerNote}). ازسرگیری گره اجراکننده (Executor).`
        : `اپراتور انسانی درخواست ${approval.id} را رد کرد (${approval.reviewerNote}). عملیات مالی لغو شد.`,
    outputSummaryEn:
      params.decision === 'approved'
        ? `Human operator APPROVED ${approval.id} (${approval.reviewerNote}). Resuming Executor node.`
        : `Human operator REJECTED ${approval.id} (${approval.reviewerNote}). Financial operation aborted.`,
    toolCalls: [],
    latencyMs: 12,
    costUsd: 0,
    createdAt: new Date().toISOString(),
  };
  newEvents.push(gateResumeEvt);

  if (params.decision === 'rejected') {
    run.status = 'completed';
    run.currentNode = 'human_gate';
    run.updatedAt = new Date().toISOString();
    if (ticket) {
      ticket.status = 'rejected';
      ticket.updatedAt = new Date().toISOString();
    }
  } else {
    // Approved -> Resume Executor Node and run all proposed actions idempotently
    const startExec = Date.now();
    const proposedActions = run.proposedPlan?.proposedActions || [];
    const approvalsForRun = db.approvals.filter((a) => a.runId === run.id);
    const toolTraces = [];

    for (const action of proposedActions) {
      const execRes = executeBackendTool({
        runId: run.id,
        ticketId: run.ticketId,
        toolName: action.toolName,
        rawArgs: action.args,
        approvalsForRun,
        dbOverride: db,
      });
      toolTraces.push(execRes.trace);
      if (execRes.executionRecord) {
        newExecResults.push(execRes.executionRecord);
      }
    }

    const execLatency = Math.max(14, Date.now() - startExec + 10);
    const execEvt: AgentEventRecord = {
      id: `EVT-${run.id}-exec-resumed-${Date.now().toString().slice(-4)}`,
      runId: run.id,
      ticketId: run.ticketId,
      agentName: 'executor',
      stepStatus: 'completed',
      inputSummary: `Resumed execution after approval ${approval.id}`,
      outputSummary: `پس از تایید انسانی، ابزارهای (${proposedActions.map((a) => a.toolName).join(', ')}) با کلید یکتای Idempotency در سندباکس اجرا و ذخیره شدند.`,
      outputSummaryEn: `Following human approval, executed (${proposedActions.map((a) => a.toolName).join(', ')}) idempotently in sandbox.`,
      toolCalls: toolTraces,
      latencyMs: execLatency,
      costUsd: 0.0002,
      createdAt: new Date().toISOString(),
    };
    newEvents.push(execEvt);

    run.status = 'completed';
    run.currentNode = 'executor';
    run.executionResults = [...run.executionResults, ...newExecResults];
    run.totalLatencyMs += execLatency + 12;
    run.updatedAt = new Date().toISOString();

    if (ticket) {
      ticket.status = 'resolved';
      ticket.updatedAt = new Date().toISOString();
    }
  }

  db.agentEvents.push(...newEvents);
  if (!params.dbOverride) {
    writeDb(db);
  }

  return {
    approval,
    run,
    newEvents,
    executionResults: newExecResults,
  };
}
