import { computed, type MaybeRefOrGetter, type Ref, toValue, watch } from "vue";
import type { Options, SortableEvent } from "sortablejs";
import { useDraggable } from "vue-draggable-plus";
import { useStyleStore } from "../../store/Style";

export function useSortable(
  element: Ref<HTMLElement | null>,
  options: MaybeRefOrGetter<Options>,
  drop: (event: SortableEvent) => void,
) {
  const styleStore = useStyleStore();
  let origin: { parent: Node; next: Node | null } | null = null;

  const sortable = useDraggable(
    element,
    computed(() => ({
      forceFallback: true,
      fallbackTolerance: 5,
      animation: 150,
      ...toValue(options),
      immediate: false,
      onStart: (event: SortableEvent) => {
        origin = event.item.parentNode && {
          parent: event.item.parentNode,
          next: event.item.nextSibling,
        };
        styleStore.startDrag();
      },
      onEnd: (event: SortableEvent) => {
        if (origin) {
          const { parent, next } = origin;
          parent.insertBefore(
            event.item,
            next?.parentNode === parent ? next : null,
          );
          origin = null;
        }
        styleStore.endDrag();
        setTimeout(() => {
          document.body.dispatchEvent(new MouseEvent("click"));
        }, 0);
        drop(event);
      },
    })),
  );

  watch(
    element,
    (target) => (target ? sortable.start(target) : sortable.destroy()),
    { flush: "post" },
  );
}
