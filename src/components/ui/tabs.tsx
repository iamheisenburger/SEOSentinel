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
    <div className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            relative shrink-0 whitespace-nowrap px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors
            ${
              active === tab.id
                ? "text-[#F7F8F8]"
                : "text-[#62666D] hover:text-[#8A8F98]"
            }
          `}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`ml-1.5 text-[11px] ${
                active === tab.id ? "text-[#8A8F98]" : "text-[#62666D]"
              }`}
            >
              {tab.count}
            </span>
          )}
          {active === tab.id && (
            <span className="absolute inset-x-0 bottom-0 h-px bg-[#F7F8F8]" />
          )}
        </button>
      ))}
    </div>
  );
}
