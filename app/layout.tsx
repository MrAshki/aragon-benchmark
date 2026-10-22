import type { Metadata } from 'next';
import { Vazirmatn, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  variable: '--font-vazirmatn',
  weight: ['400', '500', '600', '700'],
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '600'],
});

export const metadata: Metadata = {
  title: 'AgentOps — Autonomous Operations Command Center',
  description:
    'Multi-agent customer operations command center with LangGraph orchestration, Jev & Gemini 4 Argon routing, policy verification, human-in-the-loop approvals, and Firestore persistence.',
  openGraph: {
    title: 'AgentOps — Autonomous Operations Command Center',
    description:
      'Multi-agent customer operations command center with LangGraph orchestration, Jev & Gemini 4 Argon routing, policy verification, human-in-the-loop approvals, and Firestore persistence.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgentOps — Autonomous Operations Command Center',
    description:
      'Multi-agent customer operations command center with LangGraph orchestration, Jev & Gemini 4 Argon routing, policy verification, human-in-the-loop approvals, and Firestore persistence.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatn.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <body
        suppressHydrationWarning
        className="bg-[#0B0F17] text-slate-100 antialiased"
        style={{
          fontFamily: 'var(--font-vazirmatn), var(--font-jakarta), sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
