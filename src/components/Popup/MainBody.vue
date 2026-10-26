<template>
  <div class="main">
    <!-- Search -->
    <div v-if="entries.length > 0" id="search" class="search">
      <label class="search-field">
        <IconSearch />
        <input
          id="searchInput"
          ref="searchInput"
          v-model="searchText"
          :placeholder="i18n.search"
          :aria-label="i18n.search"
          type="text"
          autocomplete="off"
          spellcheck="false"
        />
        <button
          v-if="searchText"
          type="button"
          class="clear-search"
          :aria-label="i18n.clear_search"
          :title="i18n.clear_search"
          @click="clearSearch()"
        >
          <IconX />
        </button>
        <span v-else class="search-hint" aria-hidden="true">/</span>
      </label>
    </div>
    <div v-if="searchText" class="search-found">
      {{ t("search_found", String(foundCount), String(entries.length)) }}
    </div>
    <!-- Filter -->
    <div v-if="shouldFilter && filter" id="filter" class="filter-bar">
      <IconFunnel />
      <span class="filter-text"
        >{{ filterText[0] }}<b>{{ filterHost }}</b
        >{{ filterText[1] }}</span
      >
      <button type="button" @click="showAll()">
        {{ i18n.show_all }}
      </button>
    </div>
    <div v-if="backupReminder" class="reminder" role="status">
      <div class="reminder-body">
        <IconDownload />
        <div>
          <div class="reminder-title">{{ i18n.remind_backup_title }}</div>
          <div class="reminder-text">{{ i18n.remind_backup }}</div>
        </div>
      </div>
      <div class="reminder-actions">
        <button type="button" class="reminder-primary" @click="backupNow()">
          {{ i18n.backup_now }}
        </button>
        <button type="button" class="reminder-secondary" @click="remindLater()">
          {{ i18n.remind_later }}
        </button>
      </div>
    </div>
    <!-- Entries -->
    <div id="codes" class="codes">
      <section class="section">
        <div
          ref="entryList"
          class="cards"
          @keydown.down="focusEntry($event, 1)"
          @keydown.right="focusEntry($event, 1)"
          @keydown.up="focusEntry($event, -1)"
          @keydown.left="focusEntry($event, -1)"
        >
          <EntryComponent
            v-for="entry in entries"
            :key="entry.hash"
            :filtered="isFiltered(entry) || null"
            :not-searched="!isSearchedEntry(entry) || null"
            :entry="entry"
            :tabindex="getTabindex(entry)"
            :highlight="searchText"
          />
        </div>
      </section>
      <div v-if="entries.length === 0 && initComplete" class="empty no-entry">
        <div class="hero-icon"><IconKey /></div>
        <div class="hero-text">
          <h2>{{ i18n.no_entries_title }}</h2>
          <p>{{ i18n.no_entries_info }}</p>
        </div>
        <div class="empty-actions">
          <a-button variant="primary" block @click="startCapture()">
            {{ i18n.add_qr }}
          </a-button>
          <a-button block @click="addManually()">
            {{ i18n.add_secret }}
          </a-button>
        </div>
        <a class="link" href="import.html" target="_blank">{{
          i18n.import_link
        }}</a>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { storeToRefs } from "pinia";
import { useDraggable } from "vue-draggable-plus";
import { issuerName } from "../../display";
import { i18n, t } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useNotificationStore } from "../../store/Notification";
import { useStyleStore } from "../../store/Style";
import { startCapture } from "./startCapture";

import EntryComponent from "./EntryComponent.vue";

import IconSearch from "lucide-static/icons/search.svg";
import IconX from "lucide-static/icons/x.svg";
import IconFunnel from "lucide-static/icons/funnel.svg";
import IconDownload from "lucide-static/icons/download.svg";
import IconKey from "lucide-static/icons/key.svg";

const HOST_MARKER = "%HOST%";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const styleStore = useStyleStore();
const { filter, initComplete, shouldFilter, filterHost } =
  storeToRefs(accounts);
const { backupReminder } = storeToRefs(notification);

const searchText = ref("");
const searchInput = useTemplateRef<HTMLInputElement>("searchInput");

const entries = computed({
  get: () => accounts.orderedEntries,
  set: (list) => {
    accounts.reorderEntries(list);
  },
});

const foundCount = computed(
  () => entries.value.filter((entry) => isSearchedEntry(entry)).length,
);

const filterText = computed(() =>
  t("filter_accounts_for", HOST_MARKER).split(HOST_MARKER),
);

const entryList = useTemplateRef<HTMLDivElement>("entryList");

const hidesCards = computed(
  () => searchText.value !== "" || (shouldFilter.value && filter.value),
);

useDraggable(
  entryList,
  entries,
  computed(() => ({
    disabled: hidesCards.value,
    draggable: ".entry",
    filter: ".counter",
    preventOnFilter: false,
    forceFallback: true,
    fallbackTolerance: 5,
    animation: 150,
    onStart: styleStore.startDrag,
    onEnd: endDrag,
    clone: (entry: OTPEntryInterface) => entry,
  })),
);

function endDrag() {
  styleStore.endDrag();
  setTimeout(() => {
    document.body.dispatchEvent(new MouseEvent("click"));
  }, 0);
}

watch(searchText, (text) => {
  if (text) {
    accounts.stopFilter();
  }
});

function clearSearch() {
  searchText.value = "";
  searchInput.value?.focus();
}

function focusFirstEntry() {
  nextTick(() =>
    (
      entryList.value?.querySelector<HTMLElement>(".entry[tabindex='0']") ??
      searchInput.value
    )?.focus(),
  );
}

function showAll() {
  accounts.stopFilter();
  focusFirstEntry();
}

function remindLater() {
  notification.dismissBackupReminder();
  focusFirstEntry();
}

function backupNow() {
  notification.dismissBackupReminder();
  currentView.open("Backup");
}

function addManually() {
  if (accounts.currentlyEncrypted) {
    notification.alert(i18n.phrase_incorrect);
    return;
  }
  currentView.open("AddAccount");
}

function isMatchedEntry(entry: OTPEntryInterface) {
  const matchedEntries = accounts.matchedEntries;
  if (!matchedEntries) {
    return false;
  }
  for (const hash of matchedEntries) {
    if (entry.hash === hash) {
      return true;
    }
  }
  return false;
}

function isFiltered(entry: OTPEntryInterface) {
  return (
    shouldFilter.value &&
    filter.value &&
    !entry.pinned &&
    !isMatchedEntry(entry)
  );
}

function isSearchedEntry(entry: OTPEntryInterface) {
  if (searchText.value === "") {
    return true;
  }
  if (
    issuerName(entry.issuer)
      .toLowerCase()
      .includes(searchText.value.toLowerCase()) ||
    entry.account.toLowerCase().includes(searchText.value.toLowerCase())
  ) {
    return true;
  } else {
    return false;
  }
}

function isEntryVisible(entry: OTPEntryInterface) {
  return isSearchedEntry(entry) && !isFiltered(entry);
}

function getTabindex(entry: OTPEntryInterface) {
  const firstEntry = entries.value.find((entry) => isEntryVisible(entry));

  return entry === firstEntry ? 0 : -1;
}

function focusEntry(event: KeyboardEvent, step: number) {
  const visible = Array.from(
    entryList.value?.querySelectorAll<HTMLElement>(
      ".entry:not([filtered]):not([not-searched])",
    ) ?? [],
  );
  const index = visible.indexOf(document.activeElement as HTMLElement);
  if (index === -1) {
    return;
  }
  event.preventDefault();
  visible[(index + step + visible.length) % visible.length].focus();
}
</script>
