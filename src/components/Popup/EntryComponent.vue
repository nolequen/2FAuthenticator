<template>
  <a
    role="button"
    data-x-role="entry"
    :tabindex="tabindex"
    :class="{
      entry: true,
      pinnedEntry: entry.pinned,
      'no-copy': noCopy(entry.code),
      copied,
    }"
    @click="activate(entry)"
    @keydown.enter.prevent="activate(entry)"
    @keydown.shift.f10.prevent="openMenu($event)"
    @keydown.context-menu.prevent="openMenu($event)"
    @contextmenu.prevent="openMenu($event)"
  >
    <EntryAvatar :issuer="entry.issuer" :hash="entry.hash" />
    <span class="entry-text">
      <span class="issuer">
        <span class="issuer-name"
          >{{ issuerParts[0]
          }}<mark v-if="issuerParts[1]">{{ issuerParts[1] }}</mark
          >{{ issuerParts[2] }}</span
        >
        <IconPin
          v-if="entry.pinned"
          class="pinned-icon"
          role="img"
          :aria-label="i18n.pinned"
        />
      </span>
      <span class="account"
        >{{ accountParts[0]
        }}<mark v-if="accountParts[1]">{{ accountParts[1] }}</mark
        >{{ accountParts[2] }}</span
      >
    </span>
    <span
      :class="{
        code: true,
        hotp: isHotp,
        state: !isCodeShown(entry.code),
        timeout: !isHotp && remaining < 5,
      }"
      v-text="showCode(entry.code)"
    ></span>
    <svg
      v-if="!isHotp"
      v-show="sectorStart"
      :class="{ ring: true, timeout: remaining < 5 }"
      viewBox="0 0 28 28"
      aria-hidden="true"
    >
      <circle class="track" cx="14" cy="14" r="11.5" />
      <circle
        class="progress"
        cx="14"
        cy="14"
        r="11.5"
        :style="{
          animationDuration: entry.period + 's',
          animationDelay: (sectorOffset % entry.period) + 's',
        }"
      />
    </svg>
    <button
      v-else
      type="button"
      :class="{ counter: true, disabled: style.hotpDisabled }"
      :disabled="style.hotpDisabled"
      :aria-label="i18n.next_code"
      :title="i18n.next_code"
      @click.stop="nextCode(entry)"
      @keydown.enter.stop
    >
      <IconRefresh />
    </button>
  </a>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { OTPType, CodeState, MASK_DIGIT, isCodeReady } from "../../models/otp";
import {
  getCurrentTab,
  injectContentScript,
  okToInjectContentScript,
} from "../../utils";
import { formatCode, issuerName } from "../../display";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useEntryMenuStore } from "../../store/EntryMenu";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";
import { useStyleStore } from "../../store/Style";
import EntryAvatar from "./EntryAvatar.vue";

import IconPin from "lucide-static/icons/pin.svg";
import IconRefresh from "lucide-static/icons/rotate-cw.svg";

const props = defineProps<{
  entry: OTPEntryInterface;
  tabindex: number;
  highlight?: string;
}>();

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const entryMenu = useEntryMenuStore();
const menu = useMenuStore();
const notification = useNotificationStore();
const styleStore = useStyleStore();
const { sectorStart, sectorOffset, second } = storeToRefs(accounts);
const { style } = storeToRefs(styleStore);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const isHotp = computed(
  () => props.entry.type === OTPType.hotp || props.entry.type === OTPType.hhex,
);
const remaining = computed(
  () => props.entry.period - (second.value % props.entry.period),
);
const issuerParts = computed(() => splitMatch(issuerName(props.entry.issuer)));
const accountParts = computed(() => splitMatch(props.entry.account));

function splitMatch(text: string) {
  const query = props.highlight?.toLowerCase() ?? "";
  const index = query ? text.toLowerCase().indexOf(query) : -1;
  if (index === -1) {
    return [text, "", ""];
  }
  return [
    text.slice(0, index),
    text.slice(index, index + query.length),
    text.slice(index + query.length),
  ];
}

function noCopy(code: string) {
  return !isCodeReady(code);
}

function isCodeShown(code: string) {
  return code !== CodeState.Encrypted && code !== CodeState.Invalid;
}

function showCode(code: string) {
  if (code === CodeState.Encrypted) {
    return i18n.encrypted;
  } else if (code === CodeState.Invalid) {
    return i18n.invalid;
  } else {
    return formatCode(code);
  }
}

function activate(entry: OTPEntryInterface) {
  if (style.value.dragging) {
    return;
  }
  copyCode(entry);
}

function openMenu(event: MouseEvent | KeyboardEvent) {
  const card = event.currentTarget as HTMLElement;
  if (
    event instanceof KeyboardEvent ||
    document.documentElement.classList.contains("kbd")
  ) {
    card.scrollIntoView({ block: "nearest" });
    const rect = card.getBoundingClientRect();
    entryMenu.open(props.entry.hash, rect.left + 12, rect.bottom - 8);
  } else {
    entryMenu.open(props.entry.hash, event.clientX, event.clientY);
  }
}

async function nextCode(entry: OTPEntryInterface) {
  if (style.value.hotpDisabled) {
    return;
  }
  styleStore.toggleHotpDisabled();
  try {
    await entry.next();
  } catch (error) {
    await accounts.showWriteFailure(error);
  } finally {
    setTimeout(() => {
      styleStore.toggleHotpDisabled();
    }, 3000);
  }
  return;
}

async function copyCode(entry: OTPEntryInterface) {
  if (entry.code === CodeState.Invalid || entry.code.startsWith(MASK_DIGIT)) {
    return;
  }

  if (entry.code === CodeState.Encrypted) {
    currentView.lock();
    return;
  }

  const codeClipboard = document.getElementById(
    "codeClipboard",
  ) as HTMLInputElement;
  if (!codeClipboard) {
    return;
  }

  const lastActiveElement = document.activeElement as HTMLElement;
  codeClipboard.value = entry.code;
  codeClipboard.focus();
  codeClipboard.select();
  document.execCommand("Copy");
  lastActiveElement.focus();
  notification.ephermalMessage(i18n.copied);
  showCopied();

  if (menu.useAutofill) {
    await pasteCode(entry.code);
  }
}

function showCopied() {
  clearTimeout(copiedTimer);
  copied.value = false;
  requestAnimationFrame(() => {
    copied.value = true;
    copiedTimer = setTimeout(() => {
      copied.value = false;
    }, 300);
  });
}

async function pasteCode(code: string) {
  try {
    const tab = await getCurrentTab();
    if (tab && okToInjectContentScript(tab)) {
      await injectContentScript(tab);
      chrome.tabs.sendMessage(tab.id, {
        action: "pastecode",
        code,
      });
    }
  } catch (error) {
    console.error(error);
  }
}
</script>
