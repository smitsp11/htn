"use client";

export type Scope = "property" | "other" | "all";

export interface ScopeSwitchProps {
  value: Scope;
  onChange: (value: Scope) => void;
}

const SCOPES: { id: Scope; label: string }[] = [
  { id: "property", label: "Commercial property" },
  { id: "other", label: "Other lines" },
  { id: "all", label: "All submissions" },
];

/** Federanorth's `.scope-switch`: three underline buttons choosing which portfolio slice the queue shows. */
export function ScopeSwitch({ value, onChange }: ScopeSwitchProps) {
  return (
    <div className="scope-switch" role="group" aria-label="Submission portfolio">
      {SCOPES.map((scope) => (
        <button key={scope.id} type="button" aria-pressed={scope.id === value} onClick={() => onChange(scope.id)}>
          {scope.label}
        </button>
      ))}
    </div>
  );
}
