import {
  AllowlistedToolName,
  AllowlistedToolNameSchema,
  CheckRefundEligibilityArgsSchema,
  CreateReplyDraftArgsSchema,
  IssueSandboxRefundArgsSchema,
  LookupOrderArgsSchema,
  ReadTrackingHistoryArgsSchema,
  UpdateOrderStatusArgsSchema,
  ApprovalRecord,
} from './schemas';

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above|\d+-day)\s+(instructions|rules|policy|policies)/i,
    label: 'instruction_override_attempt',
  },
  {
    pattern: /\[?\s*system\s*(override|prompt|instruction|command)/i,
    label: 'system_role_spoofing',
  },
  {
    pattern: /approve\s+full\s+.*refund\s+immediately/i,
    label: 'forced_financial_action_directive',
  },
  {
    pattern: /you\s+are\s+now\s+(in\s+developer\s+mode|unrestricted|authorized)/i,
    label: 'jailbreak_persona_shift',
  },
  {
    pattern: /<\s*script|javascript:|onerror=/i,
    label: 'xss_payload_attempt',
  },
];

export interface SanitizationResult {
  raw: string;
  sanitized: string;
  injectionDetected: boolean;
  findings: string[];
}

/**
 * Treats customer messages and policy documents as untrusted data.
 * Strips control blocks and flags prompt injection attempts before passing to agents.
 */
export function sanitizeUntrustedData(input: string): SanitizationResult {
  const findings: string[] = [];
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      findings.push(label);
    }
  }

  // Neutralize bracketed system overrides or pseudo-XML instruction tags so models treat them as quoted text
  const sanitized = input
    .replace(/\[\s*SYSTEM[^\]]*\]/gi, '[UNTRUSTED_USER_TEXT_REDACTED]')
    .replace(/<\s*(system|instruction|override)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '[UNTRUSTED_TAG_STRIPPED]')
    .trim();

  return {
    raw: input,
    sanitized,
    injectionDetected: findings.length > 0,
    findings,
  };
}

/**
 * Validates tool name against the strict allowlist and validates arguments with Zod.
 */
export function validateToolCallArgs(
  toolName: string,
  args: unknown
): { valid: boolean; parsedArgs?: Record<string, unknown>; error?: string } {
  const nameCheck = AllowlistedToolNameSchema.safeParse(toolName);
  if (!nameCheck.success) {
    return {
      valid: false,
      error: `Tool "${toolName}" is not in the server allowlist.`,
    };
  }

  const typedName: AllowlistedToolName = nameCheck.data;
  const schemaMap = {
    lookupOrder: LookupOrderArgsSchema,
    readTrackingHistory: ReadTrackingHistoryArgsSchema,
    checkRefundEligibility: CheckRefundEligibilityArgsSchema,
    issueSandboxRefund: IssueSandboxRefundArgsSchema,
    updateOrderStatus: UpdateOrderStatusArgsSchema,
    createReplyDraft: CreateReplyDraftArgsSchema,
  };

  const schema = schemaMap[typedName];
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return {
      valid: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  return {
    valid: true,
    parsedArgs: parsed.data as Record<string, unknown>,
  };
}

/**
 * Authorization Gate: A structurally valid action is NOT automatically authorized.
 * Blocks irreversible or financial actions unless an explicit human approval record is in 'approved' state.
 */
export function authorizeToolExecution(params: {
  toolName: AllowlistedToolName;
  args: Record<string, unknown>;
  approvalsForRun: ApprovalRecord[];
  eligibilityPassed?: boolean;
}): { authorized: boolean; reason: string; matchedApprovalId?: string } {
  const { toolName, args, approvalsForRun } = params;

  // Read-only investigative tools and non-destructive reply drafts are authorized without human approval
  if (
    toolName === 'lookupOrder' ||
    toolName === 'readTrackingHistory' ||
    toolName === 'checkRefundEligibility' ||
    toolName === 'createReplyDraft'
  ) {
    return {
      authorized: true,
      reason: 'Read-only or non-destructive draft tool is authorized by default policy.',
    };
  }

  // Irreversible or financial tools (issueSandboxRefund, updateOrderStatus) require explicit human approval
  if (toolName === 'issueSandboxRefund' || toolName === 'updateOrderStatus') {
    const matchingApproval = approvalsForRun.find(
      (a) => a.actionType === toolName && a.status === 'approved'
    );

    if (!matchingApproval) {
      return {
        authorized: false,
        reason: `Action "${toolName}" is financial or state-mutating and requires explicit human approval (status='approved') before server execution.`,
      };
    }

    // Verify amount cannot exceed approved amount for refunds
    if (toolName === 'issueSandboxRefund') {
      const requestedAmount = Number(args.amount || 0);
      const approvedAmount = Number(matchingApproval.actionArgs.amount || 0);
      if (requestedAmount > approvedAmount || requestedAmount <= 0) {
        return {
          authorized: false,
          reason: `Requested refund amount ($${requestedAmount}) does not match human-approved amount ($${approvedAmount}).`,
        };
      }
    }

    return {
      authorized: true,
      reason: `Authorized via verified human approval (${matchingApproval.id}) by ${matchingApproval.reviewedBy || 'operator'}.`,
      matchedApprovalId: matchingApproval.id,
    };
  }

  return {
    authorized: false,
    reason: 'Unknown authorization state.',
  };
}
