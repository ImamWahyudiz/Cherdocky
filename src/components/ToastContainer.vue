<script lang="ts">
import { defineComponent, h, TransitionGroup } from 'vue';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-vue-next';
import type { Toast } from '~/composables/useToast';
import { toasts } from '~/composables/useToast';

const iconMap = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
} as const;

type ToastType = keyof typeof iconMap;

const baseClasses = 'flex items-start gap-3 px-4 py-3 rounded-lg shadow-xl min-w-[280px] max-w-md animate-toast-in transition-all duration-300';
const typeClasses: Record<ToastType, string> = {
  info: 'bg-blue-900/95 text-blue-100 border border-blue-700/50',
  success: 'bg-emerald-900/95 text-emerald-100 border border-emerald-700/50',
  warning: 'bg-amber-900/95 text-amber-100 border border-amber-700/50',
  error: 'bg-red-900/95 text-red-100 border border-red-700/50',
};

function dismiss(id: number) {
  const idx = toasts.value.findIndex((t: Toast) => t.id === id);
  if (idx !== -1) {
    toasts.value[idx].visible = false;
    setTimeout(() => {
      const i = toasts.value.findIndex((t: Toast) => t.id === id);
      if (i !== -1) toasts.value.splice(i, 1);
    }, 300);
  }
}

function renderToastIcon(type: ToastType) {
  return h(iconMap[type], { class: 'w-5 h-5 stroke-[2]' });
}

function renderToast(toast: Toast) {
  const visibleClasses = toast.visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none';
  const toastType = toast.type as ToastType;
  const classes = `${baseClasses} ${typeClasses[toastType]} ${visibleClasses} pointer-events-auto`;

  return h(
    'div',
    {
      key: toast.id,
      class: classes,
      role: 'alert',
      'aria-live': toast.type === 'error' ? 'assertive' : 'polite',
    },
    [
      h('div', { class: 'flex-shrink-0 mt-0.5' }, renderToastIcon(toastType)),
      h('div', { class: 'flex-1 min-w-0' }, [
        h('p', { class: 'text-sm font-medium leading-relaxed' }, toast.message),
        toast.action
          ? h(
              'button',
              {
                class: `mt-2 text-xs font-semibold underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                  toast.action.variant === 'primary' ? 'text-white' : 'text-gray-300'
                }`,
                onClick: toast.action.onClick,
              },
              toast.action.label
            )
          : null,
      ]),
      h(
        'button',
        {
          class: 'flex-shrink-0 text-current/70 hover:text-current transition-colors p-0.5 -mt-0.5 -mr-0.5',
          'aria-label': 'Dismiss',
          onClick: () => dismiss(toast.id),
        },
        h(X, { class: 'w-4 h-4 stroke-[2]' })
      ),
    ]
  );
}

export default defineComponent({
  setup() {
    return () =>
      h(
        TransitionGroup,
        {
          name: 'toast',
          tag: 'div',
          class: 'fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none',
        },
        {
          default: () => toasts.value.map(renderToast),
        }
      );
  },
});
</script>

<style scoped>
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.animate-toast-in {
  animation: toast-in 0.3s ease-out forwards;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease-out;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>