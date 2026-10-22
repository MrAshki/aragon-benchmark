import { z } from 'zod';

export const TicketCategorySchema = z.enum([
  'delayed_delivery',
  'refund_request',
  'technical_issue',
  'damaged_item',
  'billing_dispute',
]);
export type TicketCategory = z.infer<typeof TicketCategorySchema>;

export const TicketUrgencySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type TicketUrgency = z.infer<typeof TicketUrgencySchema>;

export const TicketStatusSchema = z.enum([
  'open',
  'investigating',
  'awaiting_approval',
  'resolved',
  'escalated',
  'rejected',
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const OrderStatusSchema = z.enum([
  'processing',
  'in_transit',
  'delivered',
  'delayed_disputed',
  'refunded',
  'replacement_sent',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const WorkflowTypeSchema = z.enum([
  'delivery_dispute_flow',
  'refund_evaluation_flow',
  'technical_escalation_flow',
  'standard_triage_flow',
]);
export type WorkflowType = z.infer<typeof WorkflowTypeSchema>;

export const AllowlistedToolNameSchema = z.enum([
  'lookupOrder',
  'readTrackingHistory',
  'checkRefundEligibility',
  'issueSandboxRefund',
  'updateOrderStatus',
  'createReplyDraft',
]);
export type AllowlistedToolName = z.infer<typeof AllowlistedToolNameSchema>;

// OpenRouter Decisions API (typesafe/jev-1.14) Question & Answer Schemas
export const JevChoiceQuestionSchema = z.object({
  type: z.literal('choice'),
  instructions: z.string(),
  criteria: z.record(z.string(), z.string()),
});

export const JevScoreQuestionSchema = z.object({
  type: z.literal('score'),
  instructions: z.string(),
  criteria: z.array(z.string()).min(2),
});

export const JevNoulQuestionSchema = z.object({
  type: z.literal('noul'),
  instructions: z.string(),
  criteria: z.object({
    false: z.string(),
    true: z.string(),
  }),
});

export const JevQuestionSchema = z.union([
  JevChoiceQuestionSchema,
  JevScoreQuestionSchema,
  JevNoulQuestionSchema,
]);

export const JevDecisionsRequestSchema = z.object({
  model: z.literal('typesafe/jev-1.14'),
  state: z.record(z.string(), z.unknown()),
  questions: z.record(z.string(), JevQuestionSchema),
});
export type JevDecisionsRequest = z.infer<typeof JevDecisionsRequestSchema>;

export const JevChoiceAnswerSchema = z.object({
  type: z.literal('choice').optional(),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1).optional(),
});

export const JevScoreAnswerSchema = z.object({
  type: z.literal('score').optional(),
  score: z.number(),
  probabilities: z.union([z.array(z.number()), z.record(z.string(), z.number())]),
  confidence: z.number().min(0).max(1).optional(),
  legend: z.array(z.string()).optional(),
});

export const JevNoulAnswerSchema = z.object({
  type: z.literal('noul').optional(),
  noul: z.boolean().optional(),
  probabilities: z
    .union([
      z.object({
        true: z.number().optional(),
        false: z.number().optional(),
      }),
      z.record(z.string(), z.number()),
      z.number(),
    ])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const JevDecisionsResponseSchema = z.object({
  answers: z.object({
    intent: JevChoiceAnswerSchema,
    urgency: JevScoreAnswerSchema,
    risk_level: JevScoreAnswerSchema,
    recommended_workflow: JevChoiceAnswerSchema,
    requires_human_approval: JevNoulAnswerSchema,
  }),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
});
export type JevDecisionsResponse = z.infer<typeof JevDecisionsResponseSchema>;

// Zod Schemas for Backend Tool Arguments
export const LookupOrderArgsSchema = z.object({
  orderId: z.string().min(3).max(64),
});

export const ReadTrackingHistoryArgsSchema = z.object({
  orderId: z.string().min(3).max(64),
  trackingNumber: z.string().min(3).max(80).optional(),
});

export const CheckRefundEligibilityArgsSchema = z.object({
  orderId: z.string().min(3).max(64),
  requestedAmount: z.number().positive().max(100000),
  reason: z.string().min(3).max(500),
});

export const IssueSandboxRefundArgsSchema = z.object({
  orderId: z.string().min(3).max(64),
  ticketId: z.string().min(3).max(64),
  amount: z.number().positive().max(100000),
  reason: z.string().min(3).max(500),
  idempotencyKey: z.string().min(6).max(128),
});

export const UpdateOrderStatusArgsSchema = z.object({
  orderId: z.string().min(3).max(64),
  ticketId: z.string().min(3).max(64),
  newStatus: OrderStatusSchema,
  note: z.string().min(3).max(500),
  idempotencyKey: z.string().min(6).max(128),
});

export const CreateReplyDraftArgsSchema = z.object({
  ticketId: z.string().min(3).max(64),
  recipientEmail: z.string().email(),
  subject: z.string().min(3).max(200),
  bodyFa: z.string().min(5).max(3000),
  bodyEn: z.string().min(5).max(3000),
  idempotencyKey: z.string().min(6).max(128),
});

// Router Decision Schema (Jev / Gemini / Rule-Based)
export const RouterDecisionSchema = z.object({
  adapter: z.enum(['jev_api', 'gemini_structured', 'rule_baseline']),
  modelName: z.string().default('typesafe/jev-1.14'),
  executionMode: z.enum(['demo_deterministic', 'live_ai']),
  intent: TicketCategorySchema,
  urgency: TicketUrgencySchema,
  riskLevel: TicketUrgencySchema,
  riskScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).default(0.9),
  recommendedWorkflow: WorkflowTypeSchema,
  probabilities: z.object({
    delayed_delivery: z.number().min(0).max(1),
    refund_request: z.number().min(0).max(1),
    technical_issue: z.number().min(0).max(1),
    damaged_item: z.number().min(0).max(1),
    billing_dispute: z.number().min(0).max(1),
  }),
  rationaleFa: z.string().min(5).max(1000),
  rationaleEn: z.string().min(5).max(1000),
  requiresHumanApprovalPrediction: z.boolean(),
  latencyMs: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  jevMeta: z
    .object({
      endpoint: z.string(),
      model: z.string(),
      intentConfidence: z.number().min(0).max(1),
      workflowConfidence: z.number().min(0).max(1),
      urgencyScoreRaw: z.number(),
      riskScoreRaw: z.number(),
      humanApprovalProbability: z.number().min(0).max(1),
      fallbackError: z.string().optional(),
    })
    .optional(),
});
export type RouterDecision = z.infer<typeof RouterDecisionSchema>;

// Proposed Action from Resolution Planner (Constrained JSON Schema)
export const ProposedActionSchema = z.object({
  toolName: z.enum(['issueSandboxRefund', 'updateOrderStatus', 'createReplyDraft']),
  args: z.record(z.string(), z.unknown()),
  isIrreversibleOrFinancial: z.boolean(),
  requiresHumanApproval: z.boolean(),
  descriptionFa: z.string(),
  descriptionEn: z.string(),
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export const ResolutionPlanSchema = z.object({
  modelUsed: z.string(),
  executionMode: z.enum(['demo_deterministic', 'live_ai']),
  summaryFa: z.string().min(5).max(1500),
  summaryEn: z.string().min(5).max(1500),
  rootCauseFa: z.string().min(5).max(1000),
  rootCauseEn: z.string().min(5).max(1000),
  policyCitations: z.array(z.string()).max(10),
  confidence: z.number().min(0).max(1),
  requiresEscalation: z.boolean(),
  proposedActions: z.array(ProposedActionSchema).min(1).max(5),
});
export type ResolutionPlan = z.infer<typeof ResolutionPlanSchema>;

// Verifier Output Schema
export const VerificationReportSchema = z.object({
  passed: z.boolean(),
  evidenceConsistent: z.boolean(),
  policyCompliant: z.boolean(),
  toolArgsValid: z.boolean(),
  missingInformation: z.array(z.string()),
  promptInjectionDetected: z.boolean(),
  injectionFindings: z.array(z.string()),
  requiresRetry: z.boolean(),
  requiresHumanApproval: z.boolean(),
  requiresEscalation: z.boolean(),
  verifierNotesFa: z.string(),
  verifierNotesEn: z.string(),
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

// Domain Entities
export interface TrackingEvent {
  timestamp: string;
  location: string;
  status: string;
  detailsFa: string;
  detailsEn: string;
  anomalyFlag?: string;
}

export interface OrderRecord {
  id: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  carrier: string;
  trackingNumber: string;
  orderedAt: string;
  deliveredAt: string | null;
  itemsSummary: string;
  itemsSummaryFa: string;
  refundedAmount: number;
  trackingEvents: TrackingEvent[];
  updatedAt: string;
}

export interface PolicyDocument {
  id: string;
  code: string;
  category: TicketCategory;
  titleFa: string;
  titleEn: string;
  contentFa: string;
  contentEn: string;
  maxRefundDays: number;
  maxAutoRefundAmount: number;
  requiresHumanApprovalOver: number;
  constraints: string[];
}

export interface TicketMessageRecord {
  id: string;
  ticketId: string;
  senderRole: 'customer' | 'agent' | 'operator' | 'system';
  senderName: string;
  content: string;
  sanitizedContent: string;
  injectionFlags: string[];
  createdAt: string;
}

export interface TicketRecord {
  id: string;
  orderId: string;
  subject: string;
  SubjectEn?: string;
  customerName: string;
  customerEmail: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketUrgency;
  scenarioId: string;
  latestRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallTrace {
  toolName: AllowlistedToolName;
  args: Record<string, unknown>;
  output: Record<string, unknown>;
  status: 'success' | 'blocked' | 'error' | 'idempotent_cached';
  latencyMs: number;
  timestamp: string;
  idempotencyKey?: string;
}

export interface AgentEventRecord {
  id: string;
  runId: string;
  ticketId: string;
  agentName:
    | 'jev_router'
    | 'investigator'
    | 'policy_analyst'
    | 'resolution_planner'
    | 'verifier'
    | 'human_gate'
    | 'executor';
  stepStatus: 'started' | 'completed' | 'paused' | 'retried' | 'failed';
  inputSummary: string;
  outputSummary: string;
  outputSummaryEn: string;
  toolCalls: ToolCallTrace[];
  latencyMs: number;
  costUsd: number;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  ticketId: string;
  orderId: string;
  actionType: 'issueSandboxRefund' | 'updateOrderStatus' | 'createReplyDraft';
  actionArgs: Record<string, unknown>;
  riskLevel: TicketUrgency;
  reasonFa: string;
  reasonEn: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewerNote: string;
  reviewedBy: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionResultRecord {
  id: string;
  idempotencyKey: string;
  runId: string;
  ticketId: string;
  toolName: AllowlistedToolName;
  args: Record<string, unknown>;
  output: Record<string, unknown>;
  status: 'executed_sandbox' | 'blocked_unauthorized' | 'failed';
  sandboxNotice: string;
  createdAt: string;
}

export interface WorkflowRunRecord {
  id: string;
  ticketId: string;
  orderId: string;
  mode: 'demo_deterministic' | 'live_ai';
  status: 'running' | 'paused_for_approval' | 'completed' | 'failed' | 'escalated';
  currentNode: string;
  retryCount: number;
  routerDecision: RouterDecision | null;
  evidence: {
    order?: OrderRecord | null;
    trackingHistory?: TrackingEvent[];
    refundEligibility?: {
      eligible: boolean;
      daysSinceDelivery: number | null;
      maxAllowedDays: number;
      reasonFa: string;
      reasonEn: string;
      requiresHumanApproval: boolean;
    };
  } | null;
  policyEvaluation: {
    matchedPolicies: PolicyDocument[];
    applicableConstraints: string[];
    withinPolicyWindow: boolean;
    notesFa: string;
    notesEn: string;
  } | null;
  proposedPlan: ResolutionPlan | null;
  verificationReport: VerificationReport | null;
  pendingApprovalIds: string[];
  executionResults: ExecutionResultRecord[];
  totalLatencyMs: number;
  estimatedCostUsd: number;
  createdAt: string;
  updatedAt: string;
}
