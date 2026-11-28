"use client";

import React, {
  createContext,
  useCallback,
  useContext,
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
}: ErrorPopupProps) {
  const mounted = useIsClient();

  if (!message || !mounted) {
    return null;
  }

  return createPortal(
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-20 left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-2rem)] max-w-lg animate-in fade-in slide-in-from-top-2 duration-150"
    >
      <div className="rounded-xl border border-rose-400/40 dark:border-purple-400/45 bg-gradient-to-br from-[#fcebf2] via-[#f6e8fc] to-[#ede8fe] dark:from-[#2c121e] dark:via-[#261226] dark:to-[#1d1129] shadow-2xl shadow-black/40 p-4 sm:p-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-rose-500/15 dark:bg-purple-500/20 border border-rose-400/40 dark:border-purple-400/40 text-rose-500 dark:text-purple-300 flex items-center justify-center font-mono font-bold text-sm shrink-0">
            !
          </div>
          <div className="space-y-1 min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-rose-600 dark:text-purple-300 leading-tight">
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
