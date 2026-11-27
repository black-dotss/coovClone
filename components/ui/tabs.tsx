"use client";

import React from "react";

export interface TabItem {
  id: string;
  label: string;
  badge?: string | number;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  className = "",
}) => {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-1 p-1 bg-surface-elevated border border-border rounded-lg ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
              isActive
                ? "bg-surface text-text shadow-xs border border-border/80 font-semibold"
                : "text-text-muted hover:text-text hover:bg-surface/50"
            }`}
          >
            {tab.icon && <span className="w-3.5 h-3.5">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-md border ${
                  isActive
                    ? "bg-surface-elevated text-text border-border"
                    : "bg-surface/60 text-text-muted border-border/40"
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
