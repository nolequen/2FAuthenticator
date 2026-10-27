<template>
  <div
    class="menu-backdrop"
    data-layer="menu"
    @click.self="entryMenu.close()"
    @contextmenu.self.prevent="entryMenu.close()"
  >
    <div
      v-if="section"
      ref="menuElement"
      class="context-menu"
      role="menu"
      :aria-label="i18n.group_actions"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @contextmenu.prevent
      @keydown="onKeydown"
    >
      <button type="button" role="menuitem" class="menu-item" @click="rename()">
        <IconPencil />{{ i18n.rename_group }}
      </button>
      <button
        type="button"
        role="menuitem"
        class="menu-item"
        @click="ungroup()"
      >
        <IconUngroup />{{ i18n.ungroup }}
      </button>
    </div>
    <div
      v-else-if="entry"
      ref="menuElement"
      class="context-menu"
      role="menu"
      :aria-label="i18n.account_actions"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @contextmenu.prevent
      @keydown="onKeydown"
    >
      <button type="button" role="menuitem" class="menu-item" @click="edit()">
        <IconPencil />{{ i18n.edit_account }}
      </button>
      <template v-if="decrypted">
        <button type="button" role="menuitem" class="menu-item" @click="pin()">
          <IconPinOff v-if="entry.pinned" /><IconPin v-else />{{
            entry.pinned ? i18n.unpin : i18n.pin_short
          }}
        </button>
        <button type="button" role="menuitem" class="menu-item" @click="qr()">
          <IconQr />{{ i18n.qr_code }}
        </button>
      </template>
      <button
        type="button"
        role="menuitem"
        class="menu-item danger"
        @click="remove()"
      >
        <IconTrash />{{ i18n.delete }}
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import {
  GROUP_MAX_LENGTH,
  groupKey,
  mergeTarget,
  normalizeGroup,
} from "../../groups";
import { i18n, t } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useEntryMenuStore } from "../../store/EntryMenu";
import { useNotificationStore } from "../../store/Notification";
import { useEntryActions } from "./entryActions";
import { focusFirstCard } from "./focus";

import IconPencil from "lucide-static/icons/pen-line.svg";
import IconPin from "lucide-static/icons/pin.svg";
import IconPinOff from "lucide-static/icons/pin-off.svg";
import IconQr from "lucide-static/icons/qr-code.svg";
import IconTrash from "lucide-static/icons/trash.svg";
import IconUngroup from "lucide-static/icons/ungroup.svg";

const MARGIN = 8;

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const entryMenu = useEntryMenuStore();
const notification = useNotificationStore();
const actions = useEntryActions();
const menuElement = useTemplateRef<HTMLDivElement>("menuElement");
const left = ref(0);
const top = ref(0);

const entry = computed(() =>
  accounts.entries.find((item) => item.hash === entryMenu.menu?.hash),
);
const section = computed(() =>
  accounts.sections.find(
    (item) => item.kind === "group" && item.key === entryMenu.menu?.group,
  ),
);
const decrypted = computed(() => entry.value?.secret !== null);

watch(
  () => entryMenu.menu,
  (menu) => {
    if (!menu) {
      return;
    }
    left.value = menu.x;
    top.value = menu.y;
    nextTick(place);
  },
  { immediate: true },
);

watch(
  () => entry.value ?? section.value,
  (current) => {
    if (!current) {
      entryMenu.close();
    }
  },
);

function place() {
  const element = menuElement.value;
  const parent = element?.offsetParent as HTMLElement | null;
  if (!element || !parent) {
    return;
  }
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  left.value = Math.max(
    MARGIN,
    Math.min(left.value, parent.clientWidth - width - MARGIN),
  );
  if (top.value + height > parent.clientHeight - MARGIN) {
    top.value -= height;
  }
  top.value = Math.max(
    MARGIN,
    Math.min(top.value, parent.clientHeight - height - MARGIN),
  );
}

function items() {
  return Array.from(
    menuElement.value?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
  );
}

function onKeydown(event: KeyboardEvent) {
  const list = items();
  const index = list.indexOf(document.activeElement as HTMLElement);
  switch (event.key) {
    case "ArrowDown":
      list[(index + 1) % list.length]?.focus();
      break;
    case "ArrowUp":
      list[(index - 1 + list.length) % list.length]?.focus();
      break;
    case "Home":
      list[0]?.focus();
      break;
    case "End":
      list[list.length - 1]?.focus();
      break;
    case "Escape":
    case "Tab":
      entryMenu.close();
      break;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
}

function edit() {
  const target = entry.value;
  entryMenu.close();
  if (target) {
    currentView.open("Account", target.hash);
  }
}

function pin() {
  const target = entry.value;
  entryMenu.close();
  if (target) {
    actions.togglePin(target);
  }
}

function qr() {
  const target = entry.value;
  entryMenu.close();
  if (target) {
    actions.showQr(target);
  }
}

async function rename() {
  const target = section.value;
  entryMenu.close();
  if (!target) {
    return;
  }
  const answer = await notification.prompt({
    title: i18n.rename_group_title,
    label: i18n.group_name,
    value: target.name,
    confirm: i18n.save,
    maxlength: GROUP_MAX_LENGTH,
  });
  const name = normalizeGroup(answer);
  if (!name || name === target.name) {
    return;
  }
  const existing = mergeTarget(accounts.entries, target.key, name);
  if (
    existing &&
    !(await notification.confirm({
      title: i18n.merge_groups_title,
      message: t("merge_groups_text", existing),
      confirm: i18n.merge,
    }))
  ) {
    return;
  }
  await accounts.renameGroup(target.key, name);
  await focusHeader(groupKey(existing ?? name));
}

async function ungroup() {
  const target = section.value;
  entryMenu.close();
  if (
    !target ||
    !(await notification.confirm({
      title: t("ungroup_title", target.name),
      message: i18n.ungroup_text,
      confirm: i18n.ungroup,
    }))
  ) {
    return;
  }
  await accounts.ungroup(target.key);
  await nextTick();
  if (document.activeElement === document.body) {
    focusFirstCard();
  }
}

async function focusHeader(key: string) {
  await nextTick();
  if (document.activeElement === document.body) {
    document
      .querySelector<HTMLElement>(
        `.section-group[data-key="${CSS.escape(key)}"] .section-header`,
      )
      ?.focus();
  }
}

async function remove() {
  const target = entry.value;
  entryMenu.close();
  if (!target || !(await actions.remove(target))) {
    return;
  }
  await nextTick();
  if (document.activeElement === document.body) {
    focusFirstCard();
  }
}
</script>
