import { MessageSquare } from "lucide-react";

interface Props {
  explanation: string;
}

export default function ExplanationPanel({ explanation }: Props) {
  if (!explanation) return null;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={15} className="text-brand-500" />
        <span className="text-sm font-semibold text-slate-700">Explanation</span>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">{explanation}</p>
    </div>
  );
}
