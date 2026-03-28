import { CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import type { ValidationResult } from "@/lib/types";
import clsx from "clsx";

interface Props {
  validation: ValidationResult;
}

export default function ValidationBadge({ validation }: Props) {
  const valid = validation.is_valid;

  return (
    <div
      className={clsx(
        "card p-4 flex items-start gap-3",
        valid
          ? "border-emerald-200 bg-emerald-50"
          : "border-red-200 bg-red-50"
      )}
    >
      <div className={clsx("shrink-0 mt-0.5", valid ? "text-emerald-500" : "text-red-500")}>
        {valid ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <ShieldCheck size={13} className={valid ? "text-emerald-600" : "text-red-600"} />
          <span
            className={clsx(
              "text-xs font-semibold uppercase tracking-wider",
              valid ? "text-emerald-700" : "text-red-700"
            )}
          >
            {valid ? "Validation Passed" : "Validation Failed"}
          </span>
        </div>
        {validation.errors.length > 0 && (
          <ul className="mt-2 space-y-1">
            {validation.errors.map((err, i) => (
              <li key={i} className="text-sm text-red-600 flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">•</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        )}
        {valid && (
          <p className="mt-1 text-xs text-emerald-600">
            SQL passed all safety checks — SELECT only, no forbidden keywords.
          </p>
        )}
      </div>
    </div>
  );
}
