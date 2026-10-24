<template>
  <div
    id="codes"
    v-bind:class="{ filter: shouldFilter && filter, search: showSearch }"
  >
    <!-- Filter -->
    <div class="under-header" id="filter" v-on:click="clearFilter()">
      {{ i18n.show_all_entries }}
    </div>
    <!-- Search -->
    <div class="under-header" id="search">
      <input
        id="searchInput"
        v-model="searchText"
        v-bind:placeholder="i18n.search"
        type="text"
        tabindex="-1"
      />
      <div id="searchHint" v-if="searchText === ''">
        <div></div>
        <div id="searchHintBorder">/</div>
        <div></div>
      </div>
    </div>
    <!-- Entries -->
    <div
      ref="entryList"
      v-on:keydown.down="focusNextEntry()"
      v-on:keydown.right="focusNextEntry()"
      v-on:keydown.up="focusLastEntry()"
      v-on:keydown.left="focusLastEntry()"
    >
      <EntryComponent
        v-for="entry in entries"
        :key="entry.hash"
        v-bind:filtered="(!entry.pinned && !isMatchedEntry(entry)) || null"
        v-bind:notSearched="!isSearchedEntry(entry) || null"
        v-bind:entry="entry"
        v-bind:tabindex="getTabindex(entry)"
      />
      <div class="no-entry" v-if="entries.length === 0 && initComplete">
        <IconKey />
        <p>
          {{ i18n.no_entires }}
        </p>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { storeToRefs } from "pinia";
import { useDraggable } from "vue-draggable-plus";
import { useAccountsStore } from "../../store/Accounts";
import { useStyleStore } from "../../store/Style";

import EntryComponent from "./EntryComponent.vue";

// import IconPlus from "../../../svg/plus.svg";
import IconKey from "../../../svg/key-solid.svg";

const accounts = useAccountsStore();
const { style } = storeToRefs(useStyleStore());
const { filter, showSearch, initComplete, shouldFilter } =
  storeToRefs(accounts);

const searchText = ref("");

const entries = computed({
  get: () => accounts.orderedEntries,
  set: (list) => {
    accounts.reorderEntries(list);
  },
});

const entryList = useTemplateRef<HTMLDivElement>("entryList");

// Don't drag if !isEditing
useDraggable(
  entryList,
  entries,
  computed(() => ({
    disabled: !style.value.isEditing,
    forceFallback: true,
    fallbackTolerance: 5,
    animation: 150,
    filter: "input",
    preventOnFilter: false,
    clone: (entry: OTPEntryInterface) => entry,
  })),
);

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

function isSearchedEntry(entry: OTPEntryInterface) {
  if (searchText.value === "") {
    return true;
  }
  if (
    entry.issuer.toLowerCase().includes(searchText.value.toLowerCase()) ||
    entry.account.toLowerCase().includes(searchText.value.toLowerCase())
  ) {
    return true;
  } else {
    return false;
  }
}

function clearFilter() {
  accounts.clearFilter();
}

function isEntryVisible(entry: OTPEntryInterface) {
  return (
    isSearchedEntry(entry) &&
    (entry.pinned ||
      !shouldFilter.value ||
      !filter.value ||
      isMatchedEntry(entry))
  );
}

function getTabindex(entry: OTPEntryInterface) {
  const firstEntry = entries.value.find((entry) => isEntryVisible(entry));

  return entry === firstEntry ? 0 : -1;
}

function findNextEntryIndex(reverse: boolean) {
  if (document.activeElement?.getAttribute("data-x-role") !== "entry") {
    return -1;
  }

  const activeIndex = Array.prototype.indexOf.call(
    document.querySelectorAll(".entry"),
    document.activeElement,
  );
  if (activeIndex === -1) {
    return -1;
  }

  // reverse modify origin array, and use slice() to make a clone first
  const _entries = reverse ? entries.value.slice().reverse() : entries.value;

  let nextIndex = _entries.findIndex(
    (entry, index) =>
      index >
        (reverse ? entries.value.length - 1 - activeIndex : activeIndex) &&
      isEntryVisible(entry),
  );

  if (nextIndex === -1) {
    nextIndex = _entries.findIndex((entry) => isEntryVisible(entry));
  }

  return nextIndex;
}

function focusNextEntry() {
  const nextIndex = findNextEntryIndex(false);
  document
    .querySelector<HTMLLinkElement>(`.entry:nth-child(${nextIndex + 1})`)
    ?.focus();
}

function focusLastEntry() {
  const lastIndex = entries.value.length - 1 - findNextEntryIndex(true);
  document
    .querySelector<HTMLLinkElement>(`.entry:nth-child(${lastIndex + 1})`)
    ?.focus();
}
</script>
