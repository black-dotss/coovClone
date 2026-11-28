"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";

export interface ErrorPopupProps {
  message: string | null | undefined;
  title?: string;
  onDismiss?: () => void;
  action?: React.ReactNode;
  autoDismissMs?: number;
}

function subscribeNoop() {
  return () => {};
}

function useIsClient() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
}

/**
 * Standard viewport-fixed error popup shared across all pages and modals.
 * Ensures every error renders with identical shape, surface card styling, and position.
 */
export function ErrorPopup({
  message,
  title = "Notice",
  onDismiss,
  action,
  autoDismissMs = 5000,
}: ErrorPopupProps) {
  const mounted = useIsClient();
  const [dismissedMsg, setDismissedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!message || !autoDismissMs || autoDismissMs <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      if (onDismiss) {
        onDismiss();
      } else {
        setDismissedMsg(message);
      }
    }, autoDismissMs);
    return () => clearTimeout(timer);
  }, [message, autoDismissMs, onDismiss]);

  if (!message || !mounted || (!onDismiss && dismissedMsg === message)) {
    return null;
  }

  return createPortal(
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-20 left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-2rem)] max-w-lg animate-in fade-in slide-in-from-top-2 duration-150"
    >
      <div className="rounded-xl border border-purple-400/50 bg-gradient-to-br from-[#fae8f5] via-[#f3e8ff] to-[#ebe5ff] dark:from-[#2a1222] dark:via-[#241129] dark:to-[#1b0f2a] shadow-2xl shadow-black/40 p-4 sm:p-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-purple-500/15 dark:bg-purple-500/20 border border-purple-400/45 text-purple-600 dark:text-purple-300 flex items-center justify-center font-mono font-bold text-sm shrink-0">
            !
          </div>
          <div className="space-y-1 min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-purple-600 dark:text-purple-300 leading-tight">
              {title}
            </h3>
            <p className="text-xs sm:text-sm text-text leading-relaxed break-words">
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {action}
          {onDismiss && (
            <Button variant="outline" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

interface GlobalErrorState {
  title: string;
  message: string;
}

interface ErrorPopupContextValue {
  showError: (message: string, title?: string) => void;
  clearError: () => void;
}

const ErrorPopupContext = createContext<ErrorPopupContextValue | null>(null);

export function ErrorPopupProvider({ children }: { children: React.ReactNode }) {
  const [errorState, setErrorState] = useState<GlobalErrorState | null>(null);

  const showError = useCallback((message: string, title = "Notice") => {
    setErrorState({ title, message });
  }, []);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  const value = useMemo(
    () => ({ showError, clearError }),
    [showError, clearError]
  );

  return (
    <ErrorPopupContext.Provider value={value}>
      {children}
      <ErrorPopup
        title={errorState?.title}
        message={errorState?.message}
        onDismiss={clearError}
      />
    </ErrorPopupContext.Provider>
  );
}

export function useErrorPopup() {
  return useContext(ErrorPopupContext);
}
