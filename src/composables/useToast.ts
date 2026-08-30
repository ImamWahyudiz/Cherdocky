import { ref } from 'vue';

export interface ToastAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export interface ToastOptions {
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: ToastAction;
  persistent?: boolean;
}

export interface Toast extends ToastOptions {
  id: number;
  visible: boolean;
}

export const toasts = ref<Toast[]>([]);
let toastId = 0;

export function useToast() {
  function show(options: ToastOptions) {
    const id = ++toastId;
    const toast: Toast = {
      id,
      message: options.message,
      type: options.type || 'info',
      duration: options.duration ?? 4000,
      action: options.action,
      persistent: options.persistent ?? false,
      visible: true,
    };
    toasts.value.push(toast);

    if (!toast.persistent && (toast.duration ?? 4000) > 0) {
      setTimeout(() => dismiss(id), toast.duration ?? 4000);
    }

    return id;
  }

  function dismiss(id: number) {
    const idx = toasts.value.findIndex((t) => t.id === id);
    if (idx !== -1) {
      toasts.value[idx].visible = false;
      setTimeout(() => {
        const i = toasts.value.findIndex((t) => t.id === id);
        if (i !== -1) toasts.value.splice(i, 1);
      }, 300);
    }
  }

  function clear() {
    toasts.value = [];
  }

  return {
    toasts,
    show,
    dismiss,
    clear,
    info: (message: string, options?: Partial<ToastOptions>) => show({ ...options, message, type: 'info' }),
    success: (message: string, options?: Partial<ToastOptions>) => show({ ...options, message, type: 'success' }),
    warning: (message: string, options?: Partial<ToastOptions>) => show({ ...options, message, type: 'warning' }),
    error: (message: string, options?: Partial<ToastOptions>) => show({ ...options, message, type: 'error' }),
  };
}

// Global toast instance for non-composable usage
let _globalToast: ReturnType<typeof useToast> | null = null;

export function getGlobalToast() {
  if (!_globalToast) {
    _globalToast = useToast();
  }
  return _globalToast;
}

// Vue plugin for global registration
export const toastPlugin = {
  install(app: any) {
    app.config.globalProperties.$toast = getGlobalToast();
    app.provide('toast', getGlobalToast());
  },
};