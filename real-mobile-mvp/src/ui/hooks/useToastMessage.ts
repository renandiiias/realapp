import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "warning" | "success";

export type ToastState = {
  message: string;
  tone: ToastTone;
};

export function useToastMessage(durationMs = 2200) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToast = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "success") => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setToast({ message, tone });
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        setToast(null);
      }, durationMs);
    },
    [durationMs],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { toast, showToast, clearToast };
}
