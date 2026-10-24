import type { MaybeRef } from "vue";
import type { Options } from "sortablejs";

export declare function useDraggable<T>(
  el: MaybeRef<HTMLElement | null>,
  list: MaybeRef<T[]>,
  options: MaybeRef<Options & { clone?: (element: T) => T }>,
): void;
