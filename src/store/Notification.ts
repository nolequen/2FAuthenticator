import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { UserSettings } from "../models/settings";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirm?: string;
  danger?: boolean;
}

const TOAST_DURATION = 1500;
const BACKUP_REMINDER_DAYS = 30;

function today() {
  return Math.floor(new Date().getTime() / 1000 / 3600 / 24);
}

export const useNotificationStore = defineStore("notification", () => {
  const message = ref<string[]>([]); // Message content for alert with ok button
  const confirmation = ref<ConfirmOptions | null>(null); // Message content for alert with yes / no
  const toast = ref(""); // Ephermal message text
  const backupReminder = ref(false);
  let answer: ((value: boolean) => void) | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const confirmMessage = computed(() => confirmation.value?.message ?? "");
  const dialogOpen = computed(
    () => message.value.length > 0 || confirmation.value !== null,
  );

  function alert(text: string) {
    message.value.unshift(text);
  }

  function closeAlert() {
    message.value.shift();
  }

  function confirm(options: string | ConfirmOptions) {
    answer?.(false);
    return new Promise((resolve: (value: boolean) => void) => {
      answer = resolve;
      confirmation.value =
        typeof options === "string" ? { message: options } : options;
    });
  }

  function answerConfirm(value: boolean) {
    const resolve = answer;
    answer = undefined;
    confirmation.value = null;
    resolve?.(value);
  }

  function ephermalMessage(text: string) {
    toast.value = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = "";
    }, TOAST_DURATION);
  }

  async function checkBackupReminder(accounts: {
    entries: OTPEntryInterface[];
    currentlyEncrypted: boolean;
  }) {
    if (accounts.entries.length === 0 || accounts.currentlyEncrypted) {
      return;
    }

    const lastReminder = UserSettings.items.lastRemindingBackupTime;
    if (!lastReminder) {
      UserSettings.items.lastRemindingBackupTime = today();
      await UserSettings.commitItems();
      return;
    }

    const days = today() - Number(lastReminder);
    if (days >= BACKUP_REMINDER_DAYS || days < 0) {
      backupReminder.value = true;
    }
  }

  async function dismissBackupReminder() {
    backupReminder.value = false;
    UserSettings.items.lastRemindingBackupTime = today();
    await UserSettings.commitItems();
  }

  return {
    message,
    confirmation,
    confirmMessage,
    dialogOpen,
    toast,
    backupReminder,
    alert,
    closeAlert,
    confirm,
    answerConfirm,
    ephermalMessage,
    checkBackupReminder,
    dismissBackupReminder,
  };
});
