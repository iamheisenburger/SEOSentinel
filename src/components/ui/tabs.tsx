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
    <div className="flex gap-1 border-b border-white/[0.06]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            relative px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors
            ${
              active === tab.id
                ? "text-[#EDEEF1]"
                : "text-[#565A6E] hover:text-[#8B8FA3]"
            }
          `}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`ml-1.5 text-[11px] ${
                active === tab.id ? "text-[#0EA5E9]" : "text-[#565A6E]"
              }`}
            >
              {tab.count}
            </span>
          )}
          {active === tab.id && (
            <span className="absolute inset-x-0 -bottom-px h-px bg-[#0EA5E9]" />
          )}
        </button>
      ))}
    </div>
  );
}
