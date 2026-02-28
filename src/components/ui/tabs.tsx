"use client";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 rounded-xl border border-[#1E293B] bg-[#111827] p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-150
            ${
              active === tab.id
                ? "bg-[#0EA5E9]/15 text-[#38BDF8] shadow-sm"
                : "text-[#64748B] hover:text-[#94A3B8] hover:bg-[#1E293B]/50"
            }
          `}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`ml-1.5 text-xs ${
                active === tab.id ? "text-[#0EA5E9]" : "text-[#475569]"
              }`}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
