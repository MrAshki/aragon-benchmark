'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  auth,
  signInWithGoogle,
  signOutUser,
  syncStateToFirestore,
  testFirestoreConnection,
} from '@/lib/firebase';
import {
  AgentEventRecord,
  ApprovalRecord,
  ExecutionResultRecord,
  OrderRecord,
  PolicyDocument,
  TicketMessageRecord,
  TicketRecord,
  WorkflowRunRecord,
} from '@/lib/schemas';
import { MeasuredMetrics } from '@/lib/store';
import { AgentFlowGraph } from '@/components/agent-flow-graph';
import { WorkflowRoutingSankey } from '@/components/workflow-routing-sankey';
import { DecisionLabPanel } from '@/components/decision-lab-panel';
import {
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  Plus,
  ShieldAlert,
  Search,
  Bell,
  ChevronDown,
  ChevronRight,
  Compass,
  GitBranch,
  Users,
  BarChart3,
  ShieldCheck,
  Settings,
  DollarSign,
  Activity,
  Headphones,
  FileText,
  AlertCircle,
  Info,
  Rocket,
  ArrowRight,
  Sparkles,
  Globe,
  Terminal,
  Package,
} from 'lucide-react';

interface FullStateResponse {
  ok: boolean;
  db: {
    orders: OrderRecord[];
    policies: PolicyDocument[];
    tickets: TicketRecord[];
    messages: TicketMessageRecord[];
    workflowRuns: WorkflowRunRecord[];
    agentEvents: AgentEventRecord[];
    approvals: ApprovalRecord[];
    executionResults: ExecutionResultRecord[];
  };
  metrics: MeasuredMetrics;
  capabilities: {
    hasGeminiKey: boolean;
    hasJevKey: boolean;
    defaultMode: 'demo_deterministic' | 'live_ai';
  };
}

export function CommandCenter() {
  // Support English ('en') matching the AetherOps reference image + instant Persian RTL ('fa') switch
  const [lang, setLang] = useState<'fa' | 'en'>('en');
  const [activeNav, setActiveNav] = useState<
    'overview' | 'workflows' | 'agents' | 'analytics' | 'approvals' | 'settings'
  >('overview');
  const [routingMapView, setRoutingMapView] = useState<'sankey' | 'reactflow'>('sankey');
  const [forceDemo, setForceDemo] = useState<boolean>(true);
  const [stateData, setStateData] = useState<FullStateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [selectedTicketId, setSelectedTicketId] = useState<string>('TCK-1001');
  const [selectedAgentNode, setSelectedAgentNode] = useState<string | null>('jev_router');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [reviewerNote, setReviewerNote] = useState<string>('');

  // Console Drawer / Modal for deep trace inspection & ticket creation
  const [showConsoleDrawer, setShowConsoleDrawer] = useState<boolean>(false);
  const [showNewTicketModal, setShowNewTicketModal] = useState<boolean>(false);
  const [newTicketOrderId, setNewTicketOrderId] = useState<string>('ORD-8841');
  const [newTicketCustomer, setNewTicketCustomer] = useState<string>('Arash Kamangir');
  const [newTicketEmail, setNewTicketEmail] = useState<string>('arash.k@example-commerce.ir');
  const [newTicketSubject, setNewTicketSubject] = useState<string>(
    'Order marked delivered by carrier but never arrived at address'
  );
  const [newTicketMessage, setNewTicketMessage] = useState<string>(
    'Order ORD-8841 shows delivered on Oct 18, but nothing arrived at my door and no signature was collected. Please refund $185.'
  );

  // Firebase Auth & Firestore connection state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [firestoreReachable, setFirestoreReachable] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    testFirestoreConnection().then((ok) => setFirestoreReachable(ok));
    const unsub = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
    });
    return () => unsub();
  }, []);

  const handleAuthToggle = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      if (firebaseUser) {
        await signOutUser();
      } else {
        await signInWithGoogle();
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Authentication could not be completed'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const fetchState = useCallback(async () => {
    setErrorBanner(null);
    try {
      const res = await fetch('/api/state');
      const data: FullStateResponse = await res.json();
      if (!data.ok) {
        throw new Error('Failed to load operational state');
      }
      setStateData(data);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Error loading state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => fetchState());
  }, [fetchState]);

  const handleRunScenario = async (ticketId: string, openConsoleAfter = false) => {
    setActionBusy(true);
    setErrorBanner(null);
    try {
      setSelectedTicketId(ticketId);
      if (openConsoleAfter) {
        setShowConsoleDrawer(true);
      }
      const res = await fetch('/api/workflows/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, forceDemo }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Workflow execution failed');
      }
      setStateData((prev) =>
        prev ? { ...prev, db: data.db, metrics: data.metrics } : prev
      );

      if (firebaseUser && data.run) {
        const ticket = data.db.tickets.find((t: TicketRecord) => t.id === ticketId);
        await syncStateToFirestore({
          ticket,
          workflowRun: {
            id: data.run.id,
            ticketId: data.run.ticketId,
            orderId: data.run.orderId,
            mode: data.run.mode,
            status: data.run.status,
            currentNode: data.run.currentNode,
            retryCount: data.run.retryCount,
            totalLatencyMs: data.run.totalLatencyMs,
            estimatedCostUsd: data.run.estimatedCostUsd,
            summaryText: data.run.proposedPlan?.summaryEn || 'Executed workflow',
          },
        });
        setLastSyncedAt(new Date().toLocaleTimeString());
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to run workflow');
    } finally {
      setActionBusy(false);
    }
  };

  const handleApprovalDecision = async (
    approvalId: string,
    decision: 'approved' | 'rejected'
  ) => {
    setActionBusy(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId,
          decision,
          reviewerNote:
            reviewerNote.trim() ||
            (decision === 'approved'
              ? 'Verified GPS telemetry discrepancy & approved sandbox refund'
              : 'Rejected by platform admin'),
          reviewedBy: firebaseUser?.email || 'sarah.chen@aetherops.ai',
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Approval action failed');
      }
      setReviewerNote('');
      setStateData((prev) =>
        prev ? { ...prev, db: data.db, metrics: data.metrics } : prev
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Approval update failed');
    } finally {
      setActionBusy(false);
    }
  };

  const handleResetSeed = async () => {
    setActionBusy(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_seed' }),
      });
      const data = await res.json();
      if (data.ok) {
        setStateData((prev) =>
          prev ? { ...prev, db: data.db, metrics: data.metrics } : prev
        );
        setSelectedTicketId('TCK-1001');
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: newTicketOrderId,
          customerName: newTicketCustomer,
          customerEmail: newTicketEmail,
          subject: newTicketSubject,
          message: newTicketMessage,
          autoRunWorkflow: true,
          forceDemo,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to submit ticket');
      }
      setStateData((prev) =>
        prev ? { ...prev, db: data.db, metrics: data.metrics } : prev
      );
      setSelectedTicketId(data.ticket.id);
      setShowNewTicketModal(false);
      setShowConsoleDrawer(true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Ticket submission failed');
    } finally {
      setActionBusy(false);
    }
  };

  const db = stateData?.db;
  const metrics = stateData?.metrics;

  const activeTicket =
    db?.tickets.find((t) => t.id === selectedTicketId) || db?.tickets[0] || null;
  const activeRun =
    db?.workflowRuns.find((r) => r.id === activeTicket?.latestRunId) ||
    db?.workflowRuns.find((r) => r.ticketId === activeTicket?.id) ||
    null;
  const activeEvents = (db?.agentEvents || []).filter(
    (e) => e.runId === activeRun?.id
  );
  const activeMessages = (db?.messages || []).filter(
    (m) => m.ticketId === activeTicket?.id
  );
  const activeOrder =
    db?.orders.find((o) => o.id === activeTicket?.orderId) || null;
  const pendingApprovals = (db?.approvals || []).filter(
    (a) => a.status === 'pending'
  );

  // Build the 3 Approval Queue cards matching the reference design + live backend approvals
  const primaryPendingApproval = pendingApprovals[0] || db?.approvals[0];

  return (
    <div
      dir={lang === 'fa' ? 'rtl' : 'ltr'}
      className="min-h-screen bg-[#070A12] text-slate-100 flex font-sans selection:bg-indigo-500/30"
    >
      {/* Ambient background glow matching reference image */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 left-1/4 h-[480px] w-[680px] rounded-full bg-indigo-600/10 blur-[130px]" />
        <div className="absolute bottom-0 right-10 h-[420px] w-[520px] rounded-full bg-violet-600/12 blur-[140px]" />
      </div>

      {/* LEFT SIDEBAR (AetherOps Reference Layout) */}
      <aside className="relative z-10 w-[248px] shrink-0 border-e border-white/[0.06] bg-[#090D18]/95 flex flex-col justify-between p-5">
        <div className="space-y-7">
          {/* Brand Logo */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-3">
              {/* 3D Faceted Hexagon Emblem */}
              <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 via-blue-600 to-cyan-400 p-[1px] shadow-[0_0_20px_rgba(99,102,241,0.5)]">
                <div className="h-full w-full rounded-[7px] bg-[#0A0F1F] flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-5 w-5">
                    <polygon
                      points="12,2 21,7 21,17 12,22 3,17 3,7"
                      fill="url(#hexGrad)"
                      stroke="#818cf8"
                      strokeWidth="1.2"
                    />
                    <polygon
                      points="12,6 17,9 17,15 12,18 7,15 7,9"
                      fill="#38bdf8"
                      fillOpacity="0.35"
                    />
                    <defs>
                      <linearGradient id="hexGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#0ea5e9" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>
              <span className="text-[17px] font-semibold tracking-tight text-white">
                AetherOps
              </span>
            </div>
          </div>

          {/* Sidebar Navigation Links */}
          <nav className="space-y-1.5">
            {[
              {
                id: 'overview' as const,
                labelEn: 'Overview',
                labelFa: 'نمای کلی فرماندهی',
                icon: Compass,
              },
              {
                id: 'workflows' as const,
                labelEn: 'Workflows',
                labelFa: 'گراف گردش‌کار',
                icon: GitBranch,
              },
              {
                id: 'agents' as const,
                labelEn: 'Agents',
                labelFa: 'تیم ایجنت‌ها (۶)',
                icon: Users,
              },
              {
                id: 'analytics' as const,
                labelEn: 'Analytics',
                labelFa: 'آزمایشگاه تصمیم (Jev)',
                icon: BarChart3,
              },
              {
                id: 'approvals' as const,
                labelEn: 'Approvals',
                labelFa: 'صندوق تاییدات',
                icon: ShieldCheck,
                badge: pendingApprovals.length,
              },
              {
                id: 'settings' as const,
                labelEn: 'Settings',
                labelFa: 'تنظیمات و اتصال',
                icon: Settings,
              },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600/35 via-indigo-500/20 to-transparent border border-indigo-500/35 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`h-4 w-4 ${
                        isActive ? 'text-indigo-400' : 'text-slate-400'
                      }`}
                    />
                    <span>{lang === 'fa' ? item.labelFa : item.labelEn}</span>
                  </div>
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-mono rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Sidebar Cards */}
        <div className="space-y-3.5 pt-6">
          {/* Platform status card */}
          <div className="rounded-2xl border border-white/[0.07] bg-[#0D1322]/90 p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
              <span>{lang === 'fa' ? 'وضعیت پلتفرم' : 'Platform status'}</span>
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            </div>
            <div className="text-xs font-medium text-emerald-400">
              {lang === 'fa' ? 'تمامی سرویس‌ها فعالند' : 'All systems operational'}
            </div>
            <button
              onClick={() => setActiveNav('analytics')}
              className="pt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
            >
              <span>{lang === 'fa' ? 'بررسی وضعیت' : 'View status'}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {/* ModelOps Mobile / Scenario Card */}
          <div className="rounded-2xl border border-white/[0.07] bg-[#0D1322]/90 p-3.5 flex items-center gap-3">
            {/* Mini Mobile Device Graphic */}
            <div className="h-20 w-11 shrink-0 rounded-lg border border-indigo-500/40 bg-gradient-to-b from-indigo-950 via-[#090D1A] to-violet-950 p-1.5 flex flex-col justify-between shadow-inner">
              <div className="h-1 w-4 mx-auto rounded-full bg-slate-700" />
              <div className="flex items-end justify-between gap-0.5 h-8 px-0.5">
                <div className="w-1.5 h-3 bg-indigo-400 rounded-t" />
                <div className="w-1.5 h-5 bg-violet-400 rounded-t" />
                <div className="w-1.5 h-7 bg-cyan-400 rounded-t" />
                <div className="w-1.5 h-4 bg-indigo-500 rounded-t" />
              </div>
              <div className="h-1 w-5 mx-auto rounded-full bg-indigo-400/50" />
            </div>

            <div className="space-y-1 min-w-0">
              <div className="text-xs font-semibold text-white truncate">
                ModelOps Mobile
              </div>
              <div className="text-[11px] text-slate-400 leading-tight">
                {lang === 'fa'
                  ? 'پایش گردش‌کارهای ایجنت در هر مکان'
                  : 'Monitor workflows anywhere'}
              </div>
              <button
                onClick={() => setShowConsoleDrawer(true)}
                className="pt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                <span>{lang === 'fa' ? 'باز کردن اپ' : 'Download app'}</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT VIEWPORT */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {/* TOP HEADER BAR */}
        <header className="flex flex-wrap items-center justify-between gap-4 px-8 py-4 border-b border-white/[0.05]">
          {/* Search Bar with ⌘K */}
          <div className="relative w-full max-w-md">
            <Search className="h-4 w-4 text-slate-400 absolute top-2.5 start-3.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                lang === 'fa'
                  ? 'جستجوی گردش‌کار، ایجنت‌ها، تاییدات...'
                  : 'Search workflows, agents, approvals...'
              }
              className="w-full rounded-xl border border-white/[0.08] bg-[#101626]/90 ps-10 pe-12 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:border-indigo-500/60 focus:outline-none"
            />
            <span className="absolute top-2 end-2.5 rounded-md border border-white/[0.08] bg-[#182036] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
              ⌘K
            </span>
          </div>

          {/* Right Controls: Scenario Quick-Switch, Language Toggle, Bell & Sarah Chen Profile */}
          <div className="flex items-center gap-4">
            {/* Mode Switch Pill */}
            <div className="hidden xl:flex items-center gap-1 rounded-xl border border-white/[0.08] bg-[#101626] p-1">
              <button
                onClick={() => setForceDemo(true)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                  forceDemo
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Demo Mode
              </button>
              <button
                onClick={() => setForceDemo(false)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                  !forceDemo
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Live Jev 1.14
              </button>
            </div>

            {/* Language Switcher */}
            <button
              onClick={() => setLang((prev) => (prev === 'en' ? 'fa' : 'en'))}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#101626] px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:border-indigo-500/40 transition-colors cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5 text-indigo-400" />
              <span>{lang === 'en' ? 'فارسی (RTL)' : 'English (LTR)'}</span>
            </button>

            {/* Notification Bell */}
            <button
              onClick={() => setShowConsoleDrawer(true)}
              className="relative rounded-xl border border-white/[0.07] bg-[#101626] p-2 text-slate-300 hover:text-white cursor-pointer"
              title="View System Alerts & Traces"
            >
              <Bell className="h-4 w-4" />
              {pendingApprovals.length > 0 && (
                <span className="absolute -top-1 -end-1 h-2.5 w-2.5 rounded-full bg-indigo-500" />
              )}
            </button>

            {/* User Profile Pill ("By Sarah Chen · Platform Admin") */}
            <button
              disabled={authBusy}
              onClick={handleAuthToggle}
              className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-[#101626]/80 ps-2.5 pe-3 py-1.5 hover:border-indigo-500/40 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  authBusy ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                }`}
              />
              <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-amber-300 p-[1px]">
                <div className="h-full w-full rounded-full bg-slate-900 flex items-center justify-center text-[11px] font-bold text-white">
                  SC
                </div>
              </div>
              <div className="text-start leading-tight">
                <div className="text-xs font-semibold text-white">
                  {authBusy
                    ? lang === 'fa'
                      ? 'در حال اتصال...'
                      : 'Signing in...'
                    : firebaseUser?.displayName || 'By Sarah Chen'}
                </div>
                <div className="text-[10px] text-slate-400">
                  {firebaseUser ? 'Firestore Synced' : 'Platform Admin'}
                </div>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 ms-1" />
            </button>
          </div>
        </header>

        {/* MAIN BODY */}
        <main className="flex-1 px-8 py-6 space-y-6 max-w-[1440px] w-full mx-auto">
          {errorBanner && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{errorBanner}</span>
              </div>
              <button
                onClick={() => setErrorBanner(null)}
                className="text-xs underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* HERO HEADER ROW */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-[28px] font-semibold tracking-tight text-white">
                {lang === 'fa'
                  ? 'مرکز فرماندهی گردش‌کار هوش مصنوعی (AI Workflow Command Center)'
                  : 'AI Workflow Command Center'}
              </h1>
              <p className="mt-1 text-xs md:text-sm text-slate-400">
                {lang === 'fa'
                  ? 'پایش مسیریابی Jev 1.14، کیفیت، تاییدات انسانی، هزینه و سلامت ایجنت‌ها در یک مکان یکپارچه.'
                  : 'Monitor routing, quality, approvals, cost, and agent health in one place.'}
              </p>

              {/* Interactive Scenario Selector Bar */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {[
                  {
                    id: 'TCK-1001',
                    labelEn: 'Scenario 1: Delayed Delivery Discrepancy ($185 Refund Gate)',
                    labelFa: 'سناریو ۱: مغایرت تحویل حامل (درگاه تایید ۱۸۵ دلار)',
                  },
                  {
                    id: 'TCK-1002',
                    labelEn: 'Scenario 2: Out-of-Policy Refund + Prompt Injection',
                    labelFa: 'سناریو ۲: بازگشت وجه خارج از مهلت ۳۰ روزه + تزریق پرامپت',
                  },
                  {
                    id: 'TCK-1003',
                    labelEn: 'Scenario 3: Ambiguous RS-485 Fault (Retry + Escalate)',
                    labelFa: 'سناریو ۳: خطای مبهم صنعتی RS-485 (بازبینی و ارجاع)',
                  },
                ].map((sc) => {
                  const isCurrent = selectedTicketId === sc.id;
                  return (
                    <button
                      key={sc.id}
                      disabled={actionBusy}
                      onClick={() => handleRunScenario(sc.id, false)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all cursor-pointer ${
                        isCurrent
                          ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200 shadow-[0_0_15px_rgba(99,102,241,0.25)]'
                          : 'border-white/[0.07] bg-[#101626]/70 text-slate-400 hover:text-slate-200 hover:border-white/15'
                      }`}
                    >
                      <Play className="h-3 w-3 text-indigo-400" />
                      <span>{lang === 'fa' ? sc.labelFa : sc.labelEn}</span>
                    </button>
                  );
                })}
                <button
                  onClick={handleResetSeed}
                  disabled={actionBusy}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#101626]/70 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                  title="Reset Seed Data"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{lang === 'fa' ? 'بازنشانی' : 'Reset'}</span>
                </button>
              </div>
            </div>

            {/* Glowing "Open Console ->" Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowNewTicketModal(true)}
                className="rounded-xl border border-indigo-500/40 bg-[#12192E] px-4 py-2.5 text-xs font-medium text-indigo-200 hover:bg-indigo-950/60 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{lang === 'fa' ? 'تیکت جدید' : 'New Ticket'}</span>
              </button>
              <button
                onClick={() => setShowConsoleDrawer(true)}
                className="rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 px-5 py-2.5 text-xs font-semibold text-white shadow-[0_0_25px_rgba(99,102,241,0.5)] transition-all cursor-pointer flex items-center gap-2"
              >
                <span>{lang === 'fa' ? 'باز کردن کنسول زنده' : 'Open Console'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* 4-COLUMN KPI CARDS ROW (Matching Reference Image) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: Monthly spend */}
            <div
              onClick={() => setActiveNav('analytics')}
              className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 flex items-center gap-4 hover:border-indigo-500/40 transition-all cursor-pointer"
            >
              <div className="h-12 w-12 shrink-0 rounded-full bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.25)]">
                <DollarSign className="h-5 w-5 text-indigo-300" />
              </div>
              <div>
                <div className="text-xs text-slate-400">
                  {lang === 'fa' ? 'هزینه ماهانه عملیات' : 'Monthly spend'}
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-white mt-0.5">
                  $48,320
                </div>
                <div className="text-[11px] font-medium text-emerald-400 mt-0.5 font-mono tabular-nums">
                  ↗ 12.4% vs last month · Run: $
                  {metrics ? metrics.totalEstimatedCostUsd.toFixed(4) : '0.0042'}
                </div>
              </div>
            </div>

            {/* KPI 2: Workflow health */}
            <div
              onClick={() => setShowConsoleDrawer(true)}
              className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 flex items-center gap-4 hover:border-indigo-500/40 transition-all cursor-pointer"
            >
              <div className="h-12 w-12 shrink-0 rounded-full bg-blue-500/15 border border-blue-400/30 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.25)]">
                <Activity className="h-5 w-5 text-blue-300" />
              </div>
              <div>
                <div className="text-xs text-slate-400">
                  {lang === 'fa' ? 'سلامت گردش‌کار' : 'Workflow health'}
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-white mt-0.5">
                  98.6%
                </div>
                <div className="text-[11px] font-medium text-emerald-400 mt-0.5 font-mono tabular-nums">
                  ↗ 2.1% vs last week · Avg {metrics?.avgLatencyMs || 92}ms
                </div>
              </div>
            </div>

            {/* KPI 3: Approval rate */}
            <div
              onClick={() => setActiveNav('approvals')}
              className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 flex items-center gap-4 hover:border-indigo-500/40 transition-all cursor-pointer"
            >
              <div className="h-12 w-12 shrink-0 rounded-full bg-teal-500/15 border border-teal-400/30 flex items-center justify-center shadow-[0_0_20px_rgba(20,184,166,0.25)]">
                <ShieldCheck className="h-5 w-5 text-teal-300" />
              </div>
              <div>
                <div className="text-xs text-slate-400">
                  {lang === 'fa' ? 'نرخ تایید انسانی' : 'Approval rate'}
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-white mt-0.5">
                  94%
                </div>
                <div className="text-[11px] font-medium text-emerald-400 mt-0.5 font-mono tabular-nums">
                  ↗ 3.4% vs last week · {pendingApprovals.length} pending
                </div>
              </div>
            </div>

            {/* KPI 4: Active agents */}
            <div
              onClick={() => setActiveNav('agents')}
              className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 flex items-center gap-4 hover:border-indigo-500/40 transition-all cursor-pointer"
            >
              <div className="h-12 w-12 shrink-0 rounded-full bg-violet-500/15 border border-violet-400/30 flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.25)]">
                <Users className="h-5 w-5 text-violet-300" />
              </div>
              <div>
                <div className="text-xs text-slate-400">
                  {lang === 'fa' ? 'ایجنت‌های فعال' : 'Active agents'}
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-white mt-0.5">
                  18
                </div>
                <div className="text-[11px] font-medium text-emerald-400 mt-0.5 font-mono tabular-nums">
                  ↗ 2 vs last week · {metrics?.totalRuns || 3} traces
                </div>
              </div>
            </div>
          </div>

          {/* VIEW SWITCHING BASED ON SIDEBAR NAVIGATION */}
          {activeNav === 'analytics' ? (
            <DecisionLabPanel lang={lang} forceDemo={forceDemo} />
          ) : activeNav === 'approvals' ? (
            /* FULL APPROVAL INBOX VIEW */
            <div className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/95 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {lang === 'fa'
                      ? 'صندوق تاییدات انسانی (Human-in-the-Loop Approval Queue)'
                      : 'Human-in-the-Loop Approval Queue'}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {lang === 'fa'
                      ? 'ابزارهای مالی و تغییر وضعیت سفارش تا زمان تایید اپراتور مسدود هستند.'
                      : 'Financial refunds (issueSandboxRefund) and order state changes remain blocked until approved.'}
                  </p>
                </div>
                <button
                  onClick={() => setActiveNav('overview')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  ← Back to Overview
                </button>
              </div>

              <div className="space-y-3">
                {(db?.approvals || []).map((apr) => (
                  <div
                    key={apr.id}
                    className="rounded-xl border border-white/[0.07] bg-[#0A0F1D] p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                        <span className="text-indigo-400 font-semibold">{apr.id}</span>
                        <span>·</span>
                        <span>Ticket: {apr.ticketId}</span>
                        <span>·</span>
                        <span>Order: {apr.orderId}</span>
                        <span>·</span>
                        <span>Tool: {apr.actionType}</span>
                      </div>
                      <div className="text-sm font-medium text-white">
                        {lang === 'fa' ? apr.reasonFa : apr.reasonEn}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        IdempotencyKey: {apr.idempotencyKey} · Status:{' '}
                        <strong className="text-amber-300">{apr.status.toUpperCase()}</strong>
                      </div>
                    </div>

                    {apr.status === 'pending' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          disabled={actionBusy}
                          onClick={() => handleApprovalDecision(apr.id, 'approved')}
                          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Approve & Execute</span>
                        </button>
                        <button
                          disabled={actionBusy}
                          onClick={() => handleApprovalDecision(apr.id, 'rejected')}
                          className="rounded-lg bg-rose-600 hover:bg-rose-500 px-3.5 py-2 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Reject</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* MAIN OVERVIEW BENTO GRID (12 Columns — Exact Reference Image Layout) */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* LEFT 7 COLUMNS: Workflow Routing Map + Bottom 2 Cards (Agent Health & System Alerts) */}
              <div className="lg:col-span-7 flex flex-col gap-5">
                {/* WORKFLOW ROUTING MAP CARD */}
                <div className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-white">
                        {lang === 'fa'
                          ? 'نقشه مسیریابی گردش‌کار (Workflow routing map)'
                          : 'Workflow routing map'}
                      </h2>
                      <Info className="h-3.5 w-3.5 text-slate-500" />
                    </div>

                    {/* Toggle between Neon Sankey & React Flow Graph + Live Indicator */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#0A0E1A] p-0.5 text-[11px]">
                        <button
                          onClick={() => setRoutingMapView('sankey')}
                          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                            routingMapView === 'sankey'
                              ? 'bg-indigo-600/40 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Routing Stream
                        </button>
                        <button
                          onClick={() => setRoutingMapView('reactflow')}
                          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                            routingMapView === 'reactflow'
                              ? 'bg-indigo-600/40 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          React Flow Nodes
                        </button>
                      </div>

                      <button
                        onClick={() =>
                          activeTicket && handleRunScenario(activeTicket.id, false)
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#141C30] px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-indigo-500/40 cursor-pointer"
                      >
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span>Live</span>
                        <ChevronDown className="h-3 w-3 text-slate-400" />
                      </button>
                    </div>
                  </div>

                  {routingMapView === 'sankey' ? (
                    <WorkflowRoutingSankey
                      lang={lang}
                      activeScenarioId={activeTicket?.scenarioId}
                      onSelectStage={(stage) => {
                        setSelectedAgentNode(stage);
                        setShowConsoleDrawer(true);
                      }}
                    />
                  ) : (
                    <AgentFlowGraph
                      run={activeRun}
                      events={activeEvents}
                      lang={lang}
                      selectedAgent={selectedAgentNode}
                      onSelectAgent={(id) => {
                        setSelectedAgentNode(id);
                        setShowConsoleDrawer(true);
                      }}
                    />
                  )}
                </div>

                {/* BOTTOM LEFT SPLIT: Agent Health (Left) & System Alerts (Right) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1">
                  {/* AGENT HEALTH CARD */}
                  <div className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[15px] font-semibold text-white">
                        {lang === 'fa' ? 'سلامت ایجنت‌ها' : 'Agent health'}
                      </h3>
                      <button
                        onClick={() => setShowConsoleDrawer(true)}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>View all</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="divide-y divide-white/[0.05]">
                      {[
                        {
                          id: 'jev_router',
                          name: 'Support Copilot',
                          sub: 'v2.4.1 · 98.2%',
                          icon: Headphones,
                          iconBg: 'bg-indigo-500/20 border-indigo-400/30 text-indigo-300',
                          points: '0,18 10,14 20,16 30,8 40,12 50,5 60,9',
                        },
                        {
                          id: 'investigator',
                          name: 'Doc Agent',
                          sub: 'v1.8.3 · 97.1%',
                          icon: FileText,
                          iconBg: 'bg-blue-500/20 border-blue-400/30 text-blue-300',
                          points: '0,16 10,15 20,10 30,13 40,7 50,9 60,4',
                        },
                        {
                          id: 'policy_analyst',
                          name: 'Policy Agent',
                          sub: 'v1.6.2 · 99.0%',
                          icon: ShieldCheck,
                          iconBg: 'bg-teal-500/20 border-teal-400/30 text-teal-300',
                          points: '0,17 10,12 20,14 30,9 40,11 50,6 60,5',
                        },
                      ].map((ag) => {
                        const Icon = ag.icon;
                        return (
                          <div
                            key={ag.id}
                            onClick={() => {
                              setSelectedAgentNode(ag.id);
                              setShowConsoleDrawer(true);
                            }}
                            className="py-3 flex items-center justify-between gap-2 hover:bg-white/[0.02] rounded-lg px-1 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`h-9 w-9 shrink-0 rounded-xl border flex items-center justify-center ${ag.iconBg}`}
                              >
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-white truncate">
                                  {ag.name}
                                </div>
                                <div className="text-[11px] font-mono tabular-nums text-slate-400">
                                  {ag.sub}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 shrink-0">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              <span>Healthy</span>
                            </div>

                            {/* Mini Sparkline */}
                            <svg className="h-6 w-14 shrink-0" viewBox="0 0 64 24">
                              <polyline
                                fill="none"
                                stroke="#34d399"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                points={ag.points}
                              />
                            </svg>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* SYSTEM ALERTS CARD */}
                  <div className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[15px] font-semibold text-white">
                        {lang === 'fa' ? 'هشدارهای سیستم' : 'System alerts'}
                      </h3>
                      <button
                        onClick={() => setShowConsoleDrawer(true)}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>View all</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="space-y-3 my-auto">
                      {/* Alert 1 */}
                      <div className="rounded-xl border border-white/[0.06] bg-[#12192B]/90 p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 shrink-0 rounded-full bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400">
                            <AlertCircle className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              High cost spike detected
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              Invoice Agent · May 24, 2:14 PM
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedTicketId('TCK-1001');
                            setShowConsoleDrawer(true);
                          }}
                          className="rounded-lg border border-white/[0.08] bg-[#1B243B] hover:bg-[#232F4D] px-3 py-1.5 text-[11px] font-medium text-slate-200 shrink-0 cursor-pointer"
                        >
                          Review
                        </button>
                      </div>

                      {/* Alert 2 */}
                      <div className="rounded-xl border border-white/[0.06] bg-[#12192B]/90 p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 shrink-0 rounded-full bg-blue-500/15 border border-blue-400/30 flex items-center justify-center text-blue-400">
                            <Info className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              Fallback volume increased
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              22% higher than usual · Prompt Guard
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedTicketId('TCK-1002');
                            setShowConsoleDrawer(true);
                          }}
                          className="rounded-lg border border-white/[0.08] bg-[#1B243B] hover:bg-[#232F4D] px-3 py-1.5 text-[11px] font-medium text-slate-200 shrink-0 cursor-pointer"
                        >
                          Review
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT 5 COLUMNS: Approval Queue + Cost Pulse + Deploy Smarter Routes */}
              <div className="lg:col-span-5 flex flex-col gap-5">
                {/* APPROVAL QUEUE CARD */}
                <div className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-white">
                        {lang === 'fa' ? 'صف تاییدات' : 'Approval queue'}
                      </h2>
                      <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-xs font-mono text-slate-200">
                        3
                      </span>
                    </div>
                    <button
                      onClick={() => setActiveNav('approvals')}
                      className="text-xs text-slate-400 hover:text-white flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>View all</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {/* Queue Row 1: Contract Review / Live Pending Refund Approval */}
                    <div className="rounded-xl border border-white/[0.06] bg-[#12192B]/90 p-3 flex items-center justify-between gap-3">
                      <div
                        onClick={() => {
                          setSelectedTicketId('TCK-1001');
                          setShowConsoleDrawer(true);
                        }}
                        className="flex items-center gap-3 min-w-0 cursor-pointer"
                      >
                        <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            Contract Review · {primaryPendingApproval?.orderId || 'ORD-8841'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                            Vendor Agreement · $120,000 ($185 Sandbox)
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {primaryPendingApproval &&
                        primaryPendingApproval.status === 'pending' ? (
                          <button
                            disabled={actionBusy}
                            onClick={() =>
                              handleApprovalDecision(primaryPendingApproval.id, 'approved')
                            }
                            title="Click to Approve & Resume LangGraph Executor"
                            className="rounded-lg bg-purple-500/25 border border-purple-400/40 hover:bg-emerald-600/40 hover:border-emerald-400 px-2.5 py-1 text-[11px] font-medium text-purple-200 transition-colors cursor-pointer"
                          >
                            Needs review ✓
                          </button>
                        ) : (
                          <span className="rounded-lg bg-emerald-500/20 border border-emerald-400/30 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                            Approved
                          </span>
                        )}
                        <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-pink-500 to-indigo-500 flex items-center justify-center text-[10px] font-bold text-white">
                          AK
                        </div>
                      </div>
                    </div>

                    {/* Queue Row 2: Invoice Agent (Approved) */}
                    <div
                      onClick={() => {
                        setSelectedTicketId('TCK-1002');
                        setShowConsoleDrawer(true);
                      }}
                      className="rounded-xl border border-white/[0.06] bg-[#12192B]/90 p-3 flex items-center justify-between gap-3 cursor-pointer hover:border-white/15 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            Invoice Agent
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                            INV-8732 · $8,430.50 (POL-REF-30 Verified)
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="rounded-lg bg-emerald-500/20 border border-emerald-400/30 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                          Approved
                        </span>
                        <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-sky-500 to-emerald-500 flex items-center justify-center text-[10px] font-bold text-white">
                          SF
                        </div>
                      </div>
                    </div>

                    {/* Queue Row 3: Support Copilot (Escalated) */}
                    <div
                      onClick={() => {
                        setSelectedTicketId('TCK-1003');
                        setShowConsoleDrawer(true);
                      }}
                      className="rounded-xl border border-white/[0.06] bg-[#12192B]/90 p-3 flex items-center justify-between gap-3 cursor-pointer hover:border-white/15 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            Support Copilot
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                            Policy Update · v2.4 (ORD-9205 L3 Escalation)
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="rounded-lg bg-amber-500/20 border border-amber-400/30 px-2.5 py-1 text-[11px] font-medium text-amber-300">
                          Escalated
                        </span>
                        <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-[10px] font-bold text-white">
                          NR
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* COST PULSE CARD */}
                <div className="rounded-2xl border border-white/[0.07] bg-[#0E1424]/90 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold text-white">
                      {lang === 'fa' ? 'ضربان هزینه (Cost pulse)' : 'Cost pulse'}
                    </h2>
                    <button className="flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer">
                      <span>This month</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-4 space-y-1">
                      <div className="text-2xl font-bold font-mono tabular-nums text-white">
                        $48,320
                      </div>
                      <div className="text-xs text-slate-400">Total spend</div>
                      <div className="text-[11px] font-mono text-emerald-400 pt-1">
                        ↗ 12.4% vs last month
                      </div>
                    </div>

                    {/* Glowing Wave + Bar Chart SVG */}
                    <div dir="ltr" className="col-span-8">
                      <svg viewBox="0 0 280 115" className="w-full h-[115px]">
                        <defs>
                          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.65" />
                            <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.1" />
                          </linearGradient>
                        </defs>

                        {/* Y-axis labels */}
                        <text x="0" y="16" fill="#64748b" fontSize="9">
                          $20K
                        </text>
                        <text x="0" y="52" fill="#64748b" fontSize="9">
                          $10K
                        </text>
                        <text x="8" y="86" fill="#64748b" fontSize="9">
                          $0
                        </text>

                        {/* Vertical Bar Columns */}
                        {[
                          { x: 38, h: 12 },
                          { x: 52, h: 16 },
                          { x: 66, h: 14 },
                          { x: 80, h: 20 },
                          { x: 94, h: 32 },
                          { x: 108, h: 24 },
                          { x: 122, h: 22 },
                          { x: 136, h: 42 },
                          { x: 150, h: 36 },
                          { x: 164, h: 30 },
                          { x: 178, h: 66 },
                          { x: 192, h: 58 },
                          { x: 206, h: 38 },
                          { x: 220, h: 52 },
                          { x: 234, h: 34 },
                          { x: 248, h: 48 },
                        ].map((b, idx) => (
                          <rect
                            key={idx}
                            x={b.x}
                            y={86 - b.h}
                            width="8"
                            height={b.h}
                            rx="3"
                            fill="url(#barGrad)"
                          />
                        ))}

                        {/* Smooth Glowing Curve */}
                        <path
                          d="M 38 76 C 60 68, 72 78, 94 54 C 112 36, 120 68, 138 44 C 154 24, 162 62, 182 20 C 198 18, 206 58, 222 34 C 236 28, 244 55, 256 38"
                          fill="none"
                          stroke="#a855f7"
                          strokeWidth="2.2"
                        />

                        {/* Peak Dot + Callout Badge ("May 24 / $2,840") */}
                        <circle cx="182" cy="20" r="3.5" fill="#ffffff" stroke="#a855f7" strokeWidth="2" />
                        <rect
                          x="200"
                          y="8"
                          width="64"
                          height="30"
                          rx="6"
                          fill="#1e1b4b"
                          stroke="#6366f1"
                          strokeWidth="1"
                        />
                        <text x="232" y="20" textAnchor="middle" fill="#94a3b8" fontSize="8">
                          May 24
                        </text>
                        <text
                          x="232"
                          y="31"
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="bold"
                        >
                          $2,840
                        </text>

                        {/* X-axis dates */}
                        <text x="38" y="104" fill="#64748b" fontSize="8">
                          May 1
                        </text>
                        <text x="86" y="104" fill="#64748b" fontSize="8">
                          May 8
                        </text>
                        <text x="134" y="104" fill="#64748b" fontSize="8">
                          May 15
                        </text>
                        <text x="184" y="104" fill="#64748b" fontSize="8">
                          May 22
                        </text>
                        <text x="234" y="104" fill="#64748b" fontSize="8">
                          May 29
                        </text>
                      </svg>
                    </div>
                  </div>
                </div>

                {/* DEPLOY SMARTER ROUTES ACCENT CARD (Bottom Right with 3D Crystal Emblem) */}
                <div className="relative rounded-2xl border border-indigo-400/35 bg-gradient-to-br from-[#171C3A] via-[#1E1B4B] to-[#311042] p-5 overflow-hidden shadow-[0_10px_40px_rgba(79,70,229,0.28)]">
                  {/* Starfield / Nebula Dots */}
                  <div
                    className="pointer-events-none absolute inset-0 opacity-40"
                    style={{
                      backgroundImage:
                        'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)',
                      backgroundSize: '22px 22px',
                    }}
                  />

                  <div className="relative z-10 flex items-center justify-between gap-4">
                    {/* 3D Faceted Crystal Emblem */}
                    <div className="hidden sm:flex h-16 w-16 shrink-0 rounded-2xl bg-indigo-950/60 border border-indigo-400/40 items-center justify-center shadow-[0_0_25px_rgba(99,102,241,0.5)]">
                      <svg viewBox="0 0 64 64" className="h-12 w-12">
                        <polygon
                          points="32,4 56,18 56,46 32,60 8,46 8,18"
                          fill="#4f46e5"
                          stroke="#a5b4fc"
                          strokeWidth="1.5"
                        />
                        <polygon points="32,4 56,18 32,32" fill="#818cf8" />
                        <polygon points="8,18 32,4 32,32" fill="#6366f1" />
                        <polygon points="8,18 32,32 8,46" fill="#3730a3" />
                        <polygon points="56,18 56,46 32,32" fill="#4338ca" />
                        <polygon points="32,32 56,46 32,60" fill="#312e81" />
                        <polygon points="8,46 32,32 32,60" fill="#1e1b4b" />
                      </svg>
                    </div>

                    <div className="flex-1 text-center sm:text-start">
                      <h3 className="text-base font-semibold text-white">
                        {lang === 'fa'
                          ? 'استقرار مسیرهای هوشمندتر (typesafe/jev-1.14)'
                          : 'Deploy smarter routes'}
                      </h3>
                      <p className="mt-1 text-xs text-indigo-200/80 leading-relaxed">
                        {lang === 'fa'
                          ? 'بهینه‌سازی کارایی، هزینه و پایداری با مسیریابی هوشمند OpenRouter Decisions API.'
                          : 'Optimize performance, cost, and reliability with intelligent routing.'}
                      </p>
                      <div className="mt-3">
                        <button
                          onClick={() => setActiveNav('analytics')}
                          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 px-5 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(139,92,246,0.5)] transition-all cursor-pointer"
                        >
                          <Rocket className="h-3.5 w-3.5" />
                          <span>{lang === 'fa' ? 'استقرار مسیر (Deploy Route)' : 'Deploy Route'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* LIVE OPERATIONS CONSOLE DRAWER / MODAL (Full Case Evidence, Timeline, Tool Calls & React Flow) */}
      {showConsoleDrawer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl rounded-2xl border border-white/15 bg-[#0B101E] p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-indigo-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    LIVE MULTI-AGENT EXECUTION TRACE · {activeTicket?.id} · ORDER{' '}
                    {activeTicket?.orderId}
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-white mt-1">
                  {activeTicket?.SubjectEn || activeTicket?.subject}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                {activeTicket && (
                  <button
                    disabled={actionBusy}
                    onClick={() => handleRunScenario(activeTicket.id, true)}
                    className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>{actionBusy ? 'Executing...' : 'Re-run LangGraph'}</span>
                  </button>
                )}
                <button
                  onClick={() => setShowConsoleDrawer(false)}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3.5 py-2 text-xs text-slate-300 cursor-pointer"
                >
                  Close Console
                </button>
              </div>
            </div>

            {/* Interactive React Flow Graph inside Console */}
            <AgentFlowGraph
              run={activeRun}
              events={activeEvents}
              lang={lang}
              selectedAgent={selectedAgentNode}
              onSelectAgent={(id) => setSelectedAgentNode(id)}
            />

            {/* Evidence + Messages + Tool Trace */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Order & Telemetry Evidence */}
              <div className="rounded-xl border border-white/10 bg-[#070A14] p-4 space-y-2.5 text-xs">
                <div className="font-semibold text-white flex items-center gap-2">
                  <Package className="h-4 w-4 text-emerald-400" />
                  <span>Order & Carrier GPS Telemetry ({activeOrder?.id})</span>
                </div>
                {activeOrder && (
                  <>
                    <div className="text-slate-300 font-mono">
                      Status: <strong className="text-emerald-400">{activeOrder.status}</strong> ·
                      Total: ${activeOrder.totalAmount.toFixed(2)} · Refunded: $
                      {activeOrder.refundedAmount.toFixed(2)}
                    </div>
                    <div className="space-y-1.5">
                      {activeOrder.trackingEvents.map((ev, idx) => (
                        <div
                          key={idx}
                          className="rounded border border-white/10 bg-slate-900/60 p-2 font-mono text-[11px]"
                        >
                          <div className="text-slate-300">
                            {ev.location} ({ev.status})
                          </div>
                          <div className="text-slate-400">{ev.detailsEn}</div>
                          {ev.anomalyFlag && (
                            <div className="text-amber-400">Anomaly: {ev.anomalyFlag}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Customer Messages & Prompt Injection Guard */}
              <div className="rounded-xl border border-white/10 bg-[#070A14] p-4 space-y-2.5 text-xs">
                <div className="font-semibold text-white flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-indigo-400" />
                  <span>Customer Messages & Prompt Injection Guard</span>
                </div>
                {activeMessages.map((m) => (
                  <div
                    key={m.id}
                    className="rounded border border-white/10 bg-slate-900/60 p-2.5 space-y-1"
                  >
                    <div className="text-[11px] font-mono text-slate-400">
                      {m.senderName} ({m.senderRole})
                    </div>
                    <div className="text-slate-200 whitespace-pre-wrap">
                      {m.sanitizedContent}
                    </div>
                    {m.injectionFlags.length > 0 && (
                      <div className="text-[11px] font-mono text-rose-400">
                        Blocked Injection Flags: {m.injectionFlags.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Agent Step Timeline & Tool Call Inspector */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Persisted Agent Execution Steps & Allowlisted Tool Calls
              </h3>
              {activeEvents.map((evt, i) => (
                <div
                  key={evt.id}
                  className="rounded-xl border border-white/10 bg-[#070A14] p-3.5 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-indigo-400 font-semibold">
                      0{i + 1}. {evt.agentName} ({evt.stepStatus.toUpperCase()})
                    </span>
                    <span className="text-slate-400">
                      {evt.latencyMs}ms · ${evt.costUsd.toFixed(4)}
                    </span>
                  </div>
                  <div className="text-slate-200">{evt.outputSummaryEn}</div>
                  {evt.toolCalls.map((tc, idx) => (
                    <div
                      key={idx}
                      className="rounded bg-black/60 border border-white/10 p-2.5 font-mono text-[11px] text-slate-300 overflow-x-auto"
                    >
                      <div>
                        Tool: <strong className="text-emerald-400">{tc.toolName}</strong> (
                        {tc.status}) · {tc.latencyMs}ms
                      </div>
                      <div className="text-slate-400">Args: {JSON.stringify(tc.args)}</div>
                      <div className="text-indigo-300">Output: {JSON.stringify(tc.output)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* NEW TICKET SUBMISSION MODAL */}
      {showNewTicketModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0E1424] p-6 space-y-4">
            <h3 className="text-base font-semibold text-white">
              Submit New Operations Ticket
            </h3>
            <form onSubmit={handleCreateTicket} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Order ID</label>
                  <select
                    value={newTicketOrderId}
                    onChange={(e) => setNewTicketOrderId(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#080B14] px-3 py-2 text-white font-mono"
                  >
                    <option value="ORD-8841">ORD-8841 ($185 Mic - Geofence Anomaly)</option>
                    <option value="ORD-7712">ORD-7712 ($640 Monitor - 48 Days Old)</option>
                    <option value="ORD-9205">ORD-9205 ($420 Industrial RS-485 Gateway)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Customer Name</label>
                  <input
                    value={newTicketCustomer}
                    onChange={(e) => setNewTicketCustomer(e.target.value)}
                    required
                    className="w-full rounded-xl border border-white/10 bg-[#080B14] px-3 py-2 text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Subject</label>
                <input
                  value={newTicketSubject}
                  onChange={(e) => setNewTicketSubject(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-[#080B14] px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Customer Message</label>
                <textarea
                  rows={4}
                  value={newTicketMessage}
                  onChange={(e) => setNewTicketMessage(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-[#080B14] px-3 py-2 text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  className="rounded-xl px-4 py-2 text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionBusy}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 font-semibold text-white cursor-pointer"
                >
                  {actionBusy ? 'Running Agents...' : 'Submit & Orchestrate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
