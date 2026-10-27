<template>
  <section
    :class="['section', `section-${section.kind}`]"
    :data-key="section.key || undefined"
  >
    <div
      ref="cards"
      class="cards"
      :data-kind="section.kind"
      :data-key="section.key"
    >
      <button
        v-if="section.kind !== 'all'"
        type="button"
        :class="['section-header', { active: menuOpen }]"
        :aria-expanded="!collapsed"
        :aria-disabled="searching || undefined"
        @click="toggle()"
        @keydown.shift.f10.prevent="openMenu($event)"
        @keydown.context-menu.prevent="openMenu($event)"
        @contextmenu.prevent="openMenu($event)"
      >
        <IconChevronDown class="chevron" />
        <span class="section-name">{{ title }}</span>
        <span class="section-count">{{ count }}</span>
      </button>
      <slot v-if="!collapsed" />
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import type { SortableEvent } from "sortablejs";
import type { EntrySection } from "../../groups";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useEntryMenuStore } from "../../store/EntryMenu";
import { useStyleStore } from "../../store/Style";
import { useSortable } from "./drag";

import IconChevronDown from "lucide-static/icons/chevron-down.svg";

const props = defineProps<{
  section: EntrySection;
  count: number;
  collapsed: boolean;
  searching: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();

const accounts = useAccountsStore();
const entryMenu = useEntryMenuStore();
const styleStore = useStyleStore();
const cards = useTemplateRef<HTMLDivElement>("cards");

const menuOpen = computed(
  () =>
    props.section.kind === "group" &&
    entryMenu.menu?.group === props.section.key,
);

const title = computed(() => {
  switch (props.section.kind) {
    case "pinned":
      return i18n.group_pinned;
    case "none":
      return i18n.group_none;
    default:
      return props.section.name;
  }
});

useSortable(
  cards,
  () => ({
    disabled: props.searching,
    group: { name: "entries", put: props.collapsed ? false : ["entries"] },
    draggable: ".entry",
    filter: ".counter",
    preventOnFilter: false,
    onMove: (event) =>
      event.from === event.to || event.dragged.dataset.locked === undefined,
  }),
  drop,
);

function drop(event: SortableEvent) {
  const hash = event.item.dataset.hash;
  const target = event.to.dataset;
  if (
    !hash ||
    event.newDraggableIndex === undefined ||
    (event.from === event.to &&
      event.newDraggableIndex === event.oldDraggableIndex)
  ) {
    return;
  }
  accounts.moveEntry(
    hash,
    {
      kind: target.kind as EntrySection["kind"],
      key: target.key ?? "",
    },
    event.newDraggableIndex,
  );
}

function toggle() {
  if (styleStore.style.dragging || props.searching) {
    return;
  }
  emit("toggle");
}

function openMenu(event: MouseEvent | KeyboardEvent) {
  if (props.section.kind !== "group") {
    return;
  }
  const header = event.currentTarget as HTMLElement;
  if (
    event instanceof KeyboardEvent ||
    document.documentElement.classList.contains("kbd")
  ) {
    const rect = header.getBoundingClientRect();
    entryMenu.openGroup(props.section.key, rect.left + 12, rect.bottom - 4);
  } else {
    entryMenu.openGroup(props.section.key, event.clientX, event.clientY);
  }
}
</script>
