import { defineStore } from "pinia";
import { ref } from "vue";
import { useStyleStore } from "./Style";

export const useNotificationStore = defineStore("notification", () => {
  const style = useStyleStore();

  const message = ref<string[]>([]); // Message content for alert with ok button
  const confirmMessage = ref(""); // Message content for alert with yes / no
  const messageIdle = ref(true); // Should show alert box?
  const notification = ref(""); // Ephermal message text
  let answer: ((value: boolean) => void) | undefined;

  function alert(text: string) {
    message.value.unshift(text);
  }

  function closeAlert() {
    messageIdle.value = false;
    message.value.shift();
    setTimeout(() => {
      messageIdle.value = true;
    }, 200);
  }

  function setConfirm(text: string) {
    confirmMessage.value = text;
  }

  function setNotification(text: string) {
    notification.value = text;
  }

  function confirm(text: string) {
    answer?.(false);
    return new Promise((resolve: (value: boolean) => void) => {
      answer = resolve;
      setConfirm(text);
    });
  }

  function answerConfirm(value: boolean) {
    const resolve = answer;
    answer = undefined;
    setConfirm("");
    resolve?.(value);
  }

  function ephermalMessage(text: string) {
    setNotification(text);
    style.showNotification();
  }

  return {
    message,
    confirmMessage,
    messageIdle,
    notification,
    alert,
    closeAlert,
    setNotification,
    confirm,
    answerConfirm,
    ephermalMessage,
  };
});
