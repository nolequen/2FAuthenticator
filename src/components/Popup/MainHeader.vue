<template>
  <header class="bar">
    <button
      id="i-menu"
      type="button"
      class="icon-button"
      :aria-label="i18n.menu"
      :title="i18n.menu"
      @click="currentView.open('Menu')"
    >
      <IconMenu />
    </button>
    <h1 class="bar-title brand">{{ i18n.extName }}</h1>
    <button
      v-if="!!defaultEncryption"
      id="i-lock"
      type="button"
      class="icon-button"
      :aria-label="i18n.lock"
      :title="i18n.lock"
      @click="lock()"
    >
      <IconLock />
    </button>
    <button
      id="i-plus"
      type="button"
      class="icon-button primary"
      :aria-label="i18n.add_code"
      :title="i18n.add_code"
      @click="currentView.open('AddMethod')"
    >
      <IconPlus />
    </button>
  </header>
</template>
<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";

// Icons
import IconMenu from "lucide-static/icons/menu.svg";
import IconLock from "lucide-static/icons/lock.svg";
import IconPlus from "lucide-static/icons/plus.svg";

const currentView = useCurrentViewStore();
const { defaultEncryption } = storeToRefs(useAccountsStore());

function lock() {
  chrome.runtime.sendMessage({ action: "lock" }, window.close);
  return;
}
</script>
