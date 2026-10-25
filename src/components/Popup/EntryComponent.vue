<template>
  <a
    role="button"
    data-x-role="entry"
    :tabindex="tabindex"
    :class="{
      entry: true,
      pinnedEntry: entry.pinned,
      'no-copy': noCopy(entry.code),
    }"
    @click="copyCode(entry)"
    @keydown.enter="copyCode(entry)"
  >
    <div class="deleteAction" @click="removeEntry(entry)">
      <IconMinusCircle />
    </div>
    <div
      v-if="entry.type !== OTPType.hotp && entry.type !== OTPType.hhex"
      v-show="sectorStart"
      class="sector"
    >
      <svg viewBox="0 0 16 16">
        <circle
          cx="8"
          cy="8"
          r="4"
          :style="{
            animationDuration: entry.period + 's',
            animationDelay: (sectorOffset % entry.period) + 's',
          }"
        />
      </svg>
    </div>
    <div
      v-if="entry.type === OTPType.hotp || entry.type === OTPType.hhex"
      :class="{ counter: true, disabled: style.hotpDisabled }"
      @click="nextCode(entry)"
    >
      <IconRedo />
    </div>
    <div class="issuer">
      {{
        entry.issuer.split("::")[0] +
        (theme === "compact" ? ` (${entry.account})` : "")
      }}
    </div>
    <div class="issuerEdit">
      <input
        v-model="entry.issuer"
        :placeholder="i18n.issuer"
        type="text"
        @change="entry.update()"
      />
    </div>
    <div
      :class="{
        code: true,
        hotp: entry.type === OTPType.hotp || entry.type === OTPType.hhex,
        timeout: entry.period - (second % entry.period) < 5,
      }"
      v-text="style.isEditing ? showBulls(entry) : showCode(entry.code)"
    ></div>
    <div class="issuer account">{{ entry.account }}</div>
    <div class="issuerEdit">
      <input
        v-model="entry.account"
        :placeholder="i18n.accountName"
        type="text"
        @change="entry.update()"
      />
    </div>
    <div
      v-if="shouldShowQrIcon(entry)"
      class="showqr"
      @click.stop="showQr(entry)"
    >
      <IconQr />
    </div>
    <div class="pin" @click.stop="pin(entry)">
      <IconPin />
    </div>
    <div class="movehandle">
      <IconBars />
    </div>
  </a>
</template>
<script setup lang="ts">
import { storeToRefs } from "pinia";
import { OTPType, CodeState, MASK_DIGIT } from "../../models/otp";
import { EntryStorage, withStorageLock } from "../../models/storage";
import { getQrUrl } from "../../models/qr";
import { getCurrentTab, okToInjectContentScript } from "../../utils";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";
import { useQrStore } from "../../store/Qr";
import { useStyleStore } from "../../store/Style";

import IconMinusCircle from "../../../svg/minus-circle.svg";
import IconRedo from "../../../svg/redo.svg";
import IconQr from "../../../svg/qrcode.svg";
import IconBars from "../../../svg/bars.svg";
import IconPin from "../../../svg/pin.svg";

defineProps<{
  entry: OTPEntryInterface;
  tabindex: number;
}>();

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const menu = useMenuStore();
const notification = useNotificationStore();
const qrStore = useQrStore();
const styleStore = useStyleStore();
const { sectorStart, sectorOffset, second } = storeToRefs(accounts);
const { style } = storeToRefs(styleStore);
const { theme } = storeToRefs(menu);

function noCopy(code: string) {
  return (
    code === CodeState.Encrypted ||
    code === CodeState.Invalid ||
    code.startsWith(MASK_DIGIT)
  );
}

function shouldShowQrIcon(entry: OTPEntryInterface) {
  return entry.secret !== null;
}

function showCode(code: string) {
  if (code === CodeState.Encrypted) {
    return i18n.encrypted;
  } else if (code === CodeState.Invalid) {
    return i18n.invalid;
  } else {
    return code;
  }
}

function showBulls(entry: OTPEntryInterface) {
  if (entry.code === CodeState.Encrypted) {
    return i18n.encrypted;
  } else if (entry.code === CodeState.Invalid) {
    return i18n.invalid;
  }

  if (entry.code.startsWith(MASK_DIGIT)) {
    return entry.code;
  }

  return MASK_DIGIT.repeat(entry.digits);
}

async function removeEntry(entry: OTPEntryInterface) {
  if (await notification.confirm(i18n.confirm_delete)) {
    await entry.delete();
    accounts.deleteCode(entry.hash);
  }
  return;
}

async function pin(entry: OTPEntryInterface) {
  accounts.pinEntry(entry);
  try {
    await withStorageLock(() => EntryStorage.set(accounts.entries));
  } catch (error) {
    await accounts.showWriteFailure(error);
    return;
  }
  const codesEl = document.getElementById("codes") as HTMLDivElement;
  codesEl.scrollTop = 0;
}

function showQr(entry: OTPEntryInterface) {
  qrStore.setQr(getQrUrl(entry));
  styleStore.showQr();
  return;
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
  if (
    style.value.isEditing ||
    entry.code === CodeState.Invalid ||
    entry.code.startsWith(MASK_DIGIT)
  ) {
    return;
  }

  if (entry.code === CodeState.Encrypted) {
    styleStore.showInfo(true);
    currentView.changeView("EnterPasswordPage");
    return;
  }

  chrome.permissions.request(
    { permissions: ["clipboardWrite"] },
    async (granted) => {
      if (granted) {
        const codeClipboard = document.getElementById(
          "codeClipboard",
        ) as HTMLInputElement;
        if (!codeClipboard) {
          return;
        }

        if (menu.useAutofill) {
          await insertContentScript();
          const tab = await getCurrentTab();
          if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              action: "pastecode",
              code: entry.code,
            });
          }
        }

        const lastActiveElement = document.activeElement as HTMLElement;
        codeClipboard.value = entry.code;
        codeClipboard.focus();
        codeClipboard.select();
        document.execCommand("Copy");
        lastActiveElement.focus();
        notification.ephermalMessage(i18n.copied);
      }
    },
  );

  return;
}

async function insertContentScript() {
  const tab = await getCurrentTab();
  if (okToInjectContentScript(tab)) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["/dist/content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["/css/content.css"],
    });
  }
}
</script>
