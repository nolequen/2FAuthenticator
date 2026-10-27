import type { MaybeRef } from "vue";
import type { Options } from "sortablejs";

export interface UseDraggableReturn {
  start(target?: HTMLElement): void;
  destroy(): void;
}

export declare function useDraggable(
  el: MaybeRef<HTMLElement | null>,
  options: MaybeRef<Options & { immediate?: boolean }>,
): UseDraggableReturn;
