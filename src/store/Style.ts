import { defineStore } from "pinia";
import { computed, reactive } from "vue";

export const useStyleStore = defineStore("style", () => {
  const style = reactive({
    timeout: false,
    isEditing: false,
    slidein: false, // menu
    slideout: false, // menu
    fadein: false, // info
    fadeout: false, // info
    show: false, // info
    qrfadein: false,
    qrfadeout: false,
    notificationFadein: false,
    notificationFadeout: false,
    hotpDisabled: false,
  });

  // Returns true if menu or info screen shown
  const isMenuShown = computed(
    () => style.fadein || style.show || style.slidein,
  );

  function showMenu() {
    style.slidein = true;
    style.slideout = false;
  }

  function hideMenu() {
    style.slidein = false;
    style.slideout = true;
    setTimeout(() => {
      style.slideout = false;
    }, 200);
  }

  function showInfo(noAnimate?: boolean) {
    if (noAnimate) {
      style.show = true;
    } else {
      style.fadein = true;
      style.fadeout = false;
    }
  }

  function hideInfo(noAnimate?: boolean) {
    if (noAnimate) {
      style.show = false;
    } else {
      style.fadein = false;
      style.fadeout = true;
    }
    setTimeout(() => {
      style.fadeout = false;
    }, 200);
  }

  function showQr() {
    style.qrfadein = true;
    style.qrfadeout = false;
  }

  function hideQr() {
    style.qrfadein = false;
    style.qrfadeout = true;
    setTimeout(() => {
      style.qrfadeout = false;
    }, 200);
  }

  function showNotification() {
    style.notificationFadein = true;
    style.notificationFadeout = false;
    setTimeout(() => {
      style.notificationFadein = false;
      style.notificationFadeout = true;
      setTimeout(() => {
        style.notificationFadeout = false;
      }, 200);
    }, 1000);
  }

  function toggleEdit() {
    style.isEditing = !style.isEditing;
  }

  function toggleHotpDisabled() {
    style.hotpDisabled = !style.hotpDisabled;
  }

  return {
    style,
    isMenuShown,
    showMenu,
    hideMenu,
    showInfo,
    hideInfo,
    showQr,
    hideQr,
    showNotification,
    toggleEdit,
    toggleHotpDisabled,
  };
});
