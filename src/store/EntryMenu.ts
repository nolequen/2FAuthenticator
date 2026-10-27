import { defineStore } from "pinia";
import { ref } from "vue";

export const useEntryMenuStore = defineStore("entryMenu", () => {
  const menu = ref<{
    hash?: string;
    group?: string;
    x: number;
    y: number;
  } | null>(null);

  function open(hash: string, x: number, y: number) {
    menu.value = { hash, x, y };
  }

  function openGroup(group: string, x: number, y: number) {
    menu.value = { group, x, y };
  }

  function close() {
    menu.value = null;
  }

  return {
    menu,
    open,
    openGroup,
    close,
  };
});
