'use client';

import React from 'react';

interface WorkflowRoutingSankeyProps {
  lang: 'fa' | 'en';
  activeScenarioId?: string;
  onSelectStage?: (stage: string) => void;
}

export function WorkflowRoutingSankey({
  lang,
  activeScenarioId,
  onSelectStage,
}: WorkflowRoutingSankeyProps) {
  const isTech = activeScenarioId === 'scenario_ambiguous_tech';
  const isPolicy = activeScenarioId === 'scenario_outside_policy';

  const p1 = isTech ? '54%' : isPolicy ? '78%' : '68%';
  const p2 = isTech ? '61%' : isPolicy ? '84%' : '72%';
  const p3 = isTech ? '88%' : isPolicy ? '94%' : '91%';

  return (
    <div dir="ltr" className="w-full select-none">
      {/* Stage Headers */}
      <div className="grid grid-cols-5 text-center text-xs font-medium text-slate-300 mb-2 px-4">
        <button
          onClick={() => onSelectStage?.('jev_router')}
          className="hover:text-white transition-colors cursor-pointer"
        >
          {lang === 'fa' ? 'ورودی (Intake)' : 'Intake'}
        </button>
        <button
          onClick={() => onSelectStage?.('jev_router')}
          className="hover:text-white transition-colors cursor-pointer"
        >
          {lang === 'fa' ? 'طبقه‌بندی (Jev)' : 'Classify'}
        </button>
        <button
          onClick={() => onSelectStage?.('investigator')}
          className="hover:text-white transition-colors cursor-pointer"
        >
          {lang === 'fa' ? 'بررسی (Review)' : 'Review'}
        </button>
        <button
          onClick={() => onSelectStage?.('verifier')}
          className="hover:text-white transition-colors cursor-pointer"
        >
          {lang === 'fa' ? 'پشتیبان (Fallback)' : 'Fallback'}
        </button>
        <button
          onClick={() => onSelectStage?.('executor')}
          className="hover:text-white transition-colors cursor-pointer"
        >
          {lang === 'fa' ? 'تحویل (Deliver)' : 'Deliver'}
        </button>
      </div>

      {/* Main Neon Sankey SVG Canvas */}
      <div className="relative h-[230px] w-full rounded-xl overflow-hidden bg-[#080B14]/70">
        {/* Subtle radial dot matrix background */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(99, 102, 241, 0.35) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
          }}
        />

        <svg
          viewBox="0 0 760 220"
          className="relative z-10 w-full h-full"
          preserveAspectRatio="none"
        >
          <defs>
            {/* Glowing Pillar Gradients */}
            <linearGradient id="pillarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c084fc" />
              <stop offset="50%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#2dd4bf" />
            </linearGradient>

            {/* Primary Violet Ribbon Gradient */}
            <linearGradient id="primaryRibbon" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.65" />
              <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.7" />
            </linearGradient>

            {/* Secondary Electric Blue Ribbon Gradient */}
            <linearGradient id="secondaryRibbon" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
              <stop offset="50%" stopColor="#2563eb" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.6" />
            </linearGradient>

            {/* Fallback Teal/Cyan Ribbon Gradient */}
            <linearGradient id="fallbackRibbon" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#14b8a6" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.6" />
            </linearGradient>

            <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* --- PRIMARY PATH RIBBONS (Top Violet Stream) --- */}
          <path
            d="M 88 38 C 145 38, 175 56, 232 56 L 232 82 C 175 82, 145 72, 88 72 Z"
            fill="url(#primaryRibbon)"
          />
          <path
            d="M 248 48 C 305 48, 335 44, 392 44 L 392 70 C 335 70, 305 74, 248 74 Z"
            fill="url(#primaryRibbon)"
          />
          <path
            d="M 408 44 C 465 44, 495 50, 552 50 L 552 74 C 495 74, 465 68, 408 68 Z"
            fill="url(#primaryRibbon)"
          />
          <path
            d="M 568 48 C 615 48, 645 68, 682 68 L 682 84 C 645 84, 615 72, 568 72 Z"
            fill="url(#primaryRibbon)"
          />

          {/* Glowing core line on Primary Path */}
          <path
            d="M 88 52 C 150 52, 175 64, 240 60 C 305 56, 335 55, 400 55 C 465 55, 495 60, 560 58 C 615 58, 645 74, 685 75"
            fill="none"
            stroke="#d8b4fe"
            strokeWidth="2.2"
            filter="url(#neonGlow)"
          />

          {/* --- SECONDARY PATH RIBBONS (Middle Blue Stream) --- */}
          <path
            d="M 88 104 C 145 104, 175 118, 232 118 L 232 138 C 175 138, 145 128, 88 128 Z"
            fill="url(#secondaryRibbon)"
          />
          <path
            d="M 248 116 C 305 116, 335 122, 392 122 L 392 140 C 335 140, 305 134, 248 134 Z"
            fill="url(#secondaryRibbon)"
          />
          <path
            d="M 408 118 C 465 118, 495 132, 552 132 L 552 150 C 495 150, 465 136, 408 136 Z"
            fill="url(#secondaryRibbon)"
          />
          <path
            d="M 568 130 C 615 130, 645 86, 682 78 L 682 90 C 645 98, 615 146, 568 146 Z"
            fill="url(#secondaryRibbon)"
          />

          {/* Glowing core line on Secondary Path */}
          <path
            d="M 88 116 C 150 116, 175 126, 240 126 C 305 126, 335 130, 400 128 C 465 128, 495 140, 560 138 C 615 138, 645 92, 685 82"
            fill="none"
            stroke="#60a5fa"
            strokeWidth="1.8"
          />

          {/* --- FALLBACK PATH RIBBONS (Bottom Cyan/Teal Stream) --- */}
          <path
            d="M 88 164 C 145 164, 175 170, 232 170 L 232 184 C 175 184, 145 178, 88 178 Z"
            fill="url(#fallbackRibbon)"
          />
          <path
            d="M 248 170 C 305 170, 335 172, 392 172 L 392 184 C 335 184, 305 182, 248 182 Z"
            fill="url(#fallbackRibbon)"
          />
          <path
            d="M 408 170 C 465 170, 495 174, 542 174 L 542 186 C 495 186, 465 182, 408 182 Z"
            fill="url(#fallbackRibbon)"
          />
          <path
            d="M 575 174 C 625 174, 650 115, 682 88 L 682 96 C 650 125, 625 184, 575 184 Z"
            fill="url(#fallbackRibbon)"
          />

          {/* Glowing core line on Fallback Path */}
          <path
            d="M 88 172 C 150 172, 175 176, 240 176 C 305 176, 335 178, 400 176 C 465 176, 495 179, 542 179 M 576 179 C 625 179, 650 120, 685 90"
            fill="none"
            stroke="#2dd4bf"
            strokeWidth="1.6"
          />

          {/* --- STAGE VERTICAL PILLARS --- */}
          {/* Stage 1: Intake Pillar */}
          <rect
            x="74"
            y="24"
            width="14"
            height="168"
            rx="7"
            fill="url(#pillarGrad)"
            filter="url(#neonGlow)"
          />
          <circle cx="81" cy="48" r="3.5" fill="#ffffff" />
          <circle cx="81" cy="116" r="3.5" fill="#ffffff" />
          <circle cx="81" cy="172" r="3.5" fill="#ffffff" />

          {/* Stage 2: Classify Pillar */}
          <rect
            x="234"
            y="34"
            width="14"
            height="158"
            rx="7"
            fill="url(#pillarGrad)"
            filter="url(#neonGlow)"
          />
          <circle cx="241" cy="60" r="3.5" fill="#ffffff" />
          <circle cx="241" cy="126" r="3.5" fill="#ffffff" />
          <circle cx="241" cy="176" r="3.5" fill="#ffffff" />

          {/* Stage 3: Review Pillar */}
          <rect
            x="394"
            y="34"
            width="14"
            height="158"
            rx="7"
            fill="url(#pillarGrad)"
            filter="url(#neonGlow)"
          />
          <circle cx="401" cy="56" r="3.5" fill="#ffffff" />
          <circle cx="401" cy="128" r="3.5" fill="#ffffff" />
          <circle cx="401" cy="176" r="3.5" fill="#ffffff" />

          {/* Stage 4: Fallback Pillar (Upper bar) */}
          <rect
            x="554"
            y="34"
            width="14"
            height="118"
            rx="7"
            fill="url(#pillarGrad)"
            filter="url(#neonGlow)"
          />
          <circle cx="561" cy="58" r="3.5" fill="#ffffff" />
          <circle cx="561" cy="138" r="3.5" fill="#ffffff" />

          {/* Stage 4 Bottom: Fallback Exclamation Circle */}
          <circle
            cx="561"
            cy="178"
            r="14"
            fill="#0d1b2a"
            stroke="#2dd4bf"
            strokeWidth="2"
            filter="url(#neonGlow)"
          />
          <text
            x="561"
            y="183"
            textAnchor="middle"
            fill="#5eead4"
            fontSize="14"
            fontWeight="bold"
          >
            !
          </text>
          <text
            x="561"
            y="206"
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="11"
          >
            Fallback
          </text>

          {/* Stage 5: Deliver Checkmark Node */}
          <circle
            cx="700"
            cy="80"
            r="22"
            fill="#1e1b4b"
            stroke="#818cf8"
            strokeWidth="2.5"
            filter="url(#neonGlow)"
          />
          <path
            d="M 692 80 L 698 86 L 710 74"
            fill="none"
            stroke="#e0e7ff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* --- PERCENTAGE LABELS --- */}
          <text x="155" y="42" fill="#e2e8f0" fontSize="12" fontWeight="600">
            {p1}
          </text>
          <text x="315" y="40" fill="#e2e8f0" fontSize="12" fontWeight="600">
            {p2}
          </text>
          <text x="625" y="54" fill="#e2e8f0" fontSize="12" fontWeight="600">
            {p3}
          </text>

          <text x="155" y="106" fill="#cbd5e1" fontSize="11" fontWeight="500">
            22%
          </text>
          <text x="315" y="114" fill="#cbd5e1" fontSize="11" fontWeight="500">
            18%
          </text>
          <text x="475" y="122" fill="#cbd5e1" fontSize="11" fontWeight="500">
            46%
          </text>

          <text x="155" y="160" fill="#94a3b8" fontSize="11">
            10%
          </text>
          <text x="315" y="165" fill="#94a3b8" fontSize="11">
            10%
          </text>
          <text x="475" y="196" fill="#cbd5e1" fontSize="11" fontWeight="500">
            63%
          </text>
        </svg>
      </div>

      {/* Bottom Path Legend Bar */}
      <div className="mt-3 rounded-xl bg-[#0D121F] border border-white/[0.06] px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]" />
          <span className="text-slate-300">Primary path</span>
          <span className="font-mono tabular-nums font-semibold text-white ms-1">
            {p1}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
          <span className="text-slate-300">Secondary path</span>
          <span className="font-mono tabular-nums font-semibold text-white ms-1">
            22%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2dd4bf]" />
          <span className="text-slate-300">Fallback path</span>
          <span className="font-mono tabular-nums font-semibold text-white ms-1">
            10%
          </span>
        </div>
      </div>
    </div>
  );
}
