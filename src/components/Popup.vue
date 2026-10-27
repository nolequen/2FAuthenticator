<template>
  <div v-cloak id="popup" @focusin="rememberFocus">
    <div class="base" data-layer="base" :inert="baseInert">
      <MainHeader />
      <MainBody />
    </div>

    <Transition name="page">
      <component
        :is="pages[current]"
        v-if="current"
        :key="current"
        class="page"
        data-layer="page"
        :inert="pageInert"
      />
    </Transition>

    <EntryMenu v-if="entryMenu" :inert="dialogOpen" />

    <EnterPasswordPage v-if="locked" :inert="lockInert" />

    <LoadingPage v-if="busy" />

    <!-- QR -->
    <div
      v-if="qr"
      class="dialog-backdrop"
      data-layer="qr"
      :inert="dialogOpen"
      @click.self="hideQr()"
      @keydown.esc="hideQr()"
    >
      <div
        class="dialog qr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-title"
      >
        <div class="qr-heading">
          <h2 id="qr-title" class="dialog-title">{{ qr.issuer }}</h2>
          <div v-if="qr.account" class="dialog-subtitle">{{ qr.account }}</div>
        </div>
        <img class="qr-image" :src="qr.url" :alt="i18n.qr_image" />
        <p class="dialog-text">{{ i18n.qr_hint }}</p>
        <button
          ref="qrClose"
          type="button"
          class="button secondary block"
          @click="hideQr()"
        >
          {{ i18n.close }}
        </button>
      </div>
    </div>

    <NotificationHandler />

    <!-- EPHERMAL MESSAGE -->
    <div class="toast-region" role="status">
      <Transition name="toast">
        <div v-if="toast" class="toast"><IconCheck />{{ toast }}</div>
      </Transition>
    </div>

    <!-- CLIPBOARD -->
    <input id="codeClipboard" type="text" tabindex="-1" aria-hidden="true" />
  </div>
</template>
<script setup lang="ts">
import { type Component, computed, nextTick, useTemplateRef, watch } from "vue";
import { storeToRefs } from "pinia";

import MainHeader from "./Popup/MainHeader.vue";
import MainBody from "./Popup/MainBody.vue";
import MenuPage from "./Popup/MenuPage.vue";
import AddMethodPage from "./Popup/AddMethodPage.vue";
import AddAccountPage from "./Popup/AddAccountPage.vue";
import AccountPage from "./Popup/AccountPage.vue";
import PreferencesPage from "./Popup/PreferencesPage.vue";
import SetPasswordPage from "./Popup/SetPasswordPage.vue";
import BackupPage from "./Popup/BackupPage.vue";
import EntryMenu from "./Popup/EntryMenu.vue";
import EnterPasswordPage from "./Popup/EnterPasswordPage.vue";
import LoadingPage from "./Popup/LoadingPage.vue";
import NotificationHandler from "./Popup/NotificationHandler.vue";
import { focusFirstCard } from "./Popup/focus";
import { type Page, useCurrentViewStore } from "../store/CurrentView";
import { useEntryMenuStore } from "../store/EntryMenu";
import { useNotificationStore } from "../store/Notification";
import { useQrStore } from "../store/Qr";

import IconCheck from "lucide-static/icons/check.svg";

const pages: { [page in Page]: Component } = {
  Menu: MenuPage,
  AddMethod: AddMethodPage,
  AddAccount: AddAccountPage,
  Account: AccountPage,
  Preferences: PreferencesPage,
  SetPassword: SetPasswordPage,
  Backup: BackupPage,
};

const qrStore = useQrStore();
const { current, locked, busy } = storeToRefs(useCurrentViewStore());
const { qr } = storeToRefs(qrStore);
const { menu: entryMenu } = storeToRefs(useEntryMenuStore());
const { toast, dialogOpen } = storeToRefs(useNotificationStore());
const qrClose = useTemplateRef<HTMLButtonElement>("qrClose");

const baseInert = computed(
  () =>
    current.value !== null ||
    locked.value ||
    busy.value ||
    qr.value !== null ||
    entryMenu.value !== null ||
    dialogOpen.value,
);
const pageInert = computed(
  () => locked.value || busy.value || qr.value !== null || dialogOpen.value,
);
const lockInert = computed(() => busy.value || dialogOpen.value);

const topLayer = computed(() => {
  if (dialogOpen.value) {
    return "dialog";
  } else if (qr.value) {
    return "qr";
  } else if (busy.value) {
    return "busy";
  } else if (locked.value) {
    return "lock";
  } else if (entryMenu.value) {
    return "menu";
  }
  return current.value ? "page" : "base";
});

const lastFocus: { [layer: string]: Element } = {};

function rememberFocus(event: FocusEvent) {
  const target = event.target as HTMLElement;
  const layer = target.closest<HTMLElement>("[data-layer]")?.dataset.layer;
  if (layer) {
    lastFocus[layer] = target;
  }
}

function focusable(element: Element | undefined): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    element.closest("[inert]") === null &&
    element.getClientRects().length > 0
  );
}

watch(topLayer, (layer) => {
  nextTick(() => {
    if (layer === "qr") {
      qrClose.value?.focus();
      return;
    }
    if (layer === "menu") {
      document
        .querySelector<HTMLElement>(".context-menu [role='menuitem']")
        ?.focus();
      return;
    }
    if (layer === "lock") {
      const input =
        document.querySelector<HTMLInputElement>(".lock-screen input");
      input?.focus();
      input?.select();
      return;
    }
    if (layer !== "base" && layer !== "page") {
      return;
    }
    const element = lastFocus[layer];
    const card = moved(element);
    if (focusable(element)) {
      element.focus();
    } else if (focusable(card)) {
      card.focus();
    } else if (layer === "base") {
      focusFirstCard();
    } else {
      document.querySelector<HTMLElement>(".page .back")?.focus();
    }
  });
});

function moved(element: Element | undefined) {
  const hash =
    element instanceof HTMLElement && element.classList.contains("entry")
      ? element.dataset.hash
      : undefined;
  return hash
    ? (document.querySelector(`.entry[data-hash="${CSS.escape(hash)}"]`) ??
        undefined)
    : undefined;
}

function hideQr() {
  qrStore.hideQr();
}
</script>
