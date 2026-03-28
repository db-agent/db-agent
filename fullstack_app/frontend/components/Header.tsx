import { Database, Zap } from "lucide-react";

export default function Header() {
  return (
    <header className="flex items-center justify-between h-14 px-6 bg-white border-b border-slate-200 shrink-0 z-10">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 bg-brand-600 rounded-lg">
          <Database size={16} className="text-white" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">DB-Agent</span>
          <span className="hidden sm:inline text-xs text-slate-400 font-normal">
            Natural Language SQL
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Zap size={12} className="text-amber-400" />
          <span>Powered by LLM</span>
        </div>
        <a
          href="https://github.com/your-org/db-agent"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-700 transition-colors hidden md:block"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
