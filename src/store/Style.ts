import { defineStore } from "pinia";
import { reactive } from "vue";

export const useStyleStore = defineStore("style", () => {
  const style = reactive({
    hotpDisabled: false,
    dragging: false,
  });

  function toggleHotpDisabled() {
    style.hotpDisabled = !style.hotpDisabled;
  }

  function startDrag() {
    style.dragging = true;
  }

  function endDrag() {
    setTimeout(() => {
      style.dragging = false;
    }, 0);
  }

  return {
    style,
    toggleHotpDisabled,
    startDrag,
    endDrag,
  };
});
