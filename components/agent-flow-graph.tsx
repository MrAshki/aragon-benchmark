'use client';

import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Node,
  Edge,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentEventRecord, WorkflowRunRecord } from '@/lib/schemas';

interface AgentFlowGraphProps {
  run: WorkflowRunRecord | null;
  events: AgentEventRecord[];
  lang: 'fa' | 'en';
  selectedAgent: string | null;
  onSelectAgent: (agentName: string) => void;
}

const NODE_META: Array<{
  id: AgentEventRecord['agentName'];
  titleFa: string;
  titleEn: string;
  roleFa: string;
  roleEn: string;
  x: number;
  y: number;
}> = [
  {
    id: 'jev_router',
    titleFa: '۱. مسیریاب Jev',
    titleEn: '1. Jev Router',
    roleFa: 'طبقه‌بندی نیت، فوریت و ریسک',
    roleEn: 'Intent, Urgency & Risk Classifier',
    x: 40,
    y: 120,
  },
  {
    id: 'investigator',
    titleFa: '۲. بازرس شواهد (موازی)',
    titleEn: '2. Investigator (Parallel)',
    roleFa: 'ابزارهای سفارش و تله‌متری GPS',
    roleEn: 'Order & Tracking Tools',
    x: 270,
    y: 35,
  },
  {
    id: 'policy_analyst',
    titleFa: '۳. تحلیلگر سیاست (موازی)',
    titleEn: '3. Policy Analyst (Parallel)',
    roleFa: 'بازیابی قوانین و قیود ۳۰ روزه',
    roleEn: 'Policy & Constraint Retrieval',
    x: 270,
    y: 205,
  },
  {
    id: 'resolution_planner',
    titleFa: '۴. برنامه‌ریز راه‌حل (Gemini 4 Argon)',
    titleEn: '4. Resolution Planner (Gemini 4 Argon)',
    roleFa: 'استنتاج شواهد و پیشنهاد ابزار',
    roleEn: 'Evidence Reasoning & Action Plan',
    x: 520,
    y: 120,
  },
  {
    id: 'verifier',
    titleFa: '۵. بازبین مستقل (Verifier)',
    titleEn: '5. Independent Verifier',
    roleFa: 'کنترل تطابق سیاست و طرحواره Zod',
    roleEn: 'Policy, Injection & Schema Guard',
    x: 775,
    y: 120,
  },
  {
    id: 'human_gate',
    titleFa: 'درگاه تایید انسانی (HITL)',
    titleEn: 'Human Approval Gate',
    roleFa: 'توقف عملیات مالی پرریسک',
    roleEn: 'Financial / High-Risk Pause',
    x: 1020,
    y: 35,
  },
  {
    id: 'executor',
    titleFa: '۶. مجری ابزار (Executor)',
    titleEn: '6. Sandbox Executor',
    roleFa: 'اجرای Idempotent ابزارهای مجاز',
    roleEn: 'Idempotent Allowlisted Tools',
    x: 1020,
    y: 205,
  },
];

export function AgentFlowGraph({
  run,
  events,
  lang,
  selectedAgent,
  onSelectAgent,
}: AgentFlowGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const eventMap = new Map<string, AgentEventRecord>();
    for (const e of events) {
      eventMap.set(e.agentName, e);
    }

    const builtNodes: Node[] = NODE_META.map((meta) => {
      const ev = eventMap.get(meta.id);
      const isSelected = selectedAgent === meta.id;
      const isCurrent = run?.currentNode === meta.id;

      let statusLabel = lang === 'fa' ? 'در انتظار' : 'Idle';
      let borderColor = '#1e293b';
      let bgColor = '#0f172a';
      let statusColor = '#64748b';

      if (ev) {
        if (ev.stepStatus === 'completed') {
          statusLabel = lang === 'fa' ? 'تکمیل‌شده' : 'Completed';
          borderColor = isSelected ? '#38bdf8' : '#10b981';
          bgColor = '#0c1927';
          statusColor = '#34d399';
        } else if (ev.stepStatus === 'paused') {
          statusLabel = lang === 'fa' ? 'منتظر تایید اپراتور' : 'Paused for Approval';
          borderColor = '#f59e0b';
          bgColor = '#1c1917';
          statusColor = '#fbbf24';
        } else if (ev.stepStatus === 'retried') {
          statusLabel = lang === 'fa' ? 'بازبینی مجدد (Retry)' : 'Retried (x1)';
          borderColor = '#38bdf8';
          bgColor = '#0f172a';
          statusColor = '#38bdf8';
        } else if (ev.stepStatus === 'failed') {
          statusLabel = lang === 'fa' ? 'خطا' : 'Failed';
          borderColor = '#f43f5e';
          bgColor = '#1f1218';
          statusColor = '#fb7185';
        }
      }

      return {
        id: meta.id,
        position: { x: meta.x, y: meta.y },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <div
              dir={lang === 'fa' ? 'rtl' : 'ltr'}
              className="text-start select-none"
              style={{ width: '190px' }}
            >
              <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-100">
                <span className="truncate">{lang === 'fa' ? meta.titleFa : meta.titleEn}</span>
                {isCurrent && (
                  <span className="text-[10px] font-mono text-sky-400 shrink-0">[ACTIVE]</span>
                )}
              </div>
              <div className="mt-1 text-[10px] text-slate-400 truncate">
                {lang === 'fa' ? meta.roleFa : meta.roleEn}
              </div>
              <div className="mt-2 pt-1.5 border-t border-slate-800/90 flex items-center justify-between text-[10px] font-mono tabular-nums">
                <span style={{ color: statusColor }}>{statusLabel}</span>
                <span className="text-slate-400">
                  {ev ? `${ev.latencyMs}ms` : '—'}
                </span>
              </div>
            </div>
          ),
        },
        style: {
          background: bgColor,
          border: `1.5px solid ${borderColor}`,
          borderRadius: '10px',
          padding: '10px 12px',
          width: 216,
          boxShadow: isSelected ? '0 0 0 2px rgba(56, 189, 248, 0.35)' : 'none',
          cursor: 'pointer',
        },
      };
    });

    const hasRetry = (run?.retryCount || 0) > 0;
    const isPausedAtGate = run?.status === 'paused_for_approval';
    const hasExecuted = eventMap.has('executor');
    const wentThroughGate = eventMap.has('human_gate');

    const builtEdges: Edge[] = [
      {
        id: 'e-router-inv',
        source: 'jev_router',
        target: 'investigator',
        animated: Boolean(run),
        style: { stroke: '#38bdf8', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#38bdf8' },
      },
      {
        id: 'e-router-pol',
        source: 'jev_router',
        target: 'policy_analyst',
        animated: Boolean(run),
        style: { stroke: '#38bdf8', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#38bdf8' },
      },
      {
        id: 'e-inv-plan',
        source: 'investigator',
        target: 'resolution_planner',
        style: { stroke: '#10b981', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
      },
      {
        id: 'e-pol-plan',
        source: 'policy_analyst',
        target: 'resolution_planner',
        style: { stroke: '#10b981', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
      },
      {
        id: 'e-plan-ver',
        source: 'resolution_planner',
        target: 'verifier',
        style: { stroke: '#10b981', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
      },
      {
        id: 'e-ver-retry',
        source: 'verifier',
        target: 'resolution_planner',
        label: hasRetry ? (lang === 'fa' ? 'بازبینی (۱x)' : 'Retry (1x)') : undefined,
        animated: hasRetry,
        style: {
          stroke: hasRetry ? '#38bdf8' : '#334155',
          strokeWidth: hasRetry ? 1.5 : 1,
          strokeDasharray: '4 4',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: hasRetry ? '#38bdf8' : '#334155',
        },
      },
      {
        id: 'e-ver-gate',
        source: 'verifier',
        target: 'human_gate',
        animated: isPausedAtGate,
        style: {
          stroke: wentThroughGate ? '#f59e0b' : '#334155',
          strokeWidth: wentThroughGate ? 2 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: wentThroughGate ? '#f59e0b' : '#334155',
        },
      },
      {
        id: 'e-gate-exec',
        source: 'human_gate',
        target: 'executor',
        animated: wentThroughGate && hasExecuted,
        style: {
          stroke: wentThroughGate && hasExecuted ? '#10b981' : '#334155',
          strokeWidth: wentThroughGate && hasExecuted ? 2 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: wentThroughGate && hasExecuted ? '#10b981' : '#334155',
        },
      },
      {
        id: 'e-ver-exec',
        source: 'verifier',
        target: 'executor',
        style: {
          stroke: !wentThroughGate && hasExecuted ? '#10b981' : '#334155',
          strokeWidth: !wentThroughGate && hasExecuted ? 2 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: !wentThroughGate && hasExecuted ? '#10b981' : '#334155',
        },
      },
    ];

    return { nodes: builtNodes, edges: builtEdges };
  }, [run, events, lang, selectedAgent]);

  return (
    <div dir="ltr" className="h-[310px] w-full rounded-lg border border-slate-800/90 bg-slate-950/90 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        onNodeClick={(_, node) => onSelectAgent(node.id)}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background color="#1e293b" gap={20} size={1} />
        <Controls
          showInteractive={false}
          className="!bg-slate-900 !border-slate-800 !fill-slate-300"
        />
      </ReactFlow>
    </div>
  );
}
