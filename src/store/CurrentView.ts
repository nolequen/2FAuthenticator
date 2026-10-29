import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useEntryMenuStore } from "./EntryMenu";

export type Page =
  | "Menu"
  | "AddMethod"
  | "AddAccount"
  | "Account"
  | "Preferences"
  | "SetPassword"
  | "Backup"
  | "DriveCopies"
  | "BackupPassword";

export const useCurrentViewStore = defineStore("currentView", () => {
  const stack = ref<Page[]>([]);
  const accountHash = ref("");
  const busy = ref(false);
  const locked = ref(false);
  const entryMenu = useEntryMenuStore();

  const current = computed(() => stack.value[stack.value.length - 1] ?? null);

  function open(page: Page, hash?: string) {
    if (locked.value) {
      return;
    }
    entryMenu.close();
    if (hash !== undefined) {
      accountHash.value = hash;
    }
    stack.value.push(page);
  }

  function back() {
    stack.value.pop();
  }

  function close() {
    stack.value = [];
  }

  function setBusy(value: boolean) {
    busy.value = value;
  }

  async function withBusy<T>(action: () => Promise<T>) {
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  }

  function lock() {
    entryMenu.close();
    locked.value = true;
  }

  function unlock() {
    locked.value = false;
  }

  return {
    stack,
    accountHash,
    busy,
    locked,
    current,
    open,
    back,
    close,
    setBusy,
    withBusy,
    lock,
    unlock,
  };
});
