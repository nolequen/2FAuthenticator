<template>
  <div
    v-if="dialogOpen"
    class="dialog-backdrop"
    @keydown.esc="cancel()"
    @click.self="cancel()"
  >
    <!-- PROMPT -->
    <form
      v-if="promptOptions"
      ref="form"
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      @submit.prevent="submit()"
    >
      <h2 id="dialog-title" class="dialog-title">{{ promptOptions.title }}</h2>
      <a-text-input
        v-model="promptValue"
        :label="promptOptions.label"
        :maxlength="promptOptions.maxlength"
        :spellcheck="false"
      />
      <div class="buttons">
        <button
          type="button"
          class="button secondary"
          @click="notification.answerPrompt(null)"
        >
          {{ i18n.cancel }}
        </button>
        <button
          type="submit"
          class="button primary"
          :disabled="!promptValue.trim()"
        >
          {{ promptOptions.confirm }}
        </button>
      </div>
    </form>

    <!-- CONFIRM -->
    <div
      v-else-if="confirmation"
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="confirmation.title ? 'dialog-title' : undefined"
      aria-describedby="dialog-text"
    >
      <div v-if="confirmation.danger" class="dialog-icon danger">
        <IconTrash />
      </div>
      <h2 v-if="confirmation.title" id="dialog-title" class="dialog-title">
        {{ confirmation.title }}
      </h2>
      <p id="dialog-text" class="dialog-text">{{ confirmation.message }}</p>
      <div class="buttons">
        <button type="button" class="button secondary" @click="answer(false)">
          {{ confirmation.title ? i18n.cancel : i18n.no }}
        </button>
        <button
          ref="primary"
          type="button"
          :class="['button', confirmation.danger ? 'danger' : 'primary']"
          @click="answer(true)"
        >
          {{ confirmation.confirm ?? i18n.yes }}
        </button>
      </div>
    </div>

    <!-- MESSAGE -->
    <div
      v-else
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-describedby="dialog-text"
    >
      <p id="dialog-text" class="dialog-text message">{{ message[0] }}</p>
      <div class="buttons">
        <button
          ref="primary"
          type="button"
          class="button primary"
          @click="closeAlert()"
        >
          {{ i18n.ok }}
        </button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from "vue";
import { storeToRefs } from "pinia";
import { useNotificationStore } from "../../store/Notification";

import IconTrash from "lucide-static/icons/trash.svg";

const notification = useNotificationStore();
const { message, confirmation, promptOptions, dialogOpen } =
  storeToRefs(notification);
const primary = useTemplateRef<HTMLButtonElement>("primary");
const form = useTemplateRef<HTMLFormElement>("form");
const promptValue = ref("");

watch(
  () => [
    dialogOpen.value,
    confirmation.value,
    promptOptions.value,
    message.value[0],
  ],
  () => {
    promptValue.value = promptOptions.value?.value ?? "";
    nextTick(() => {
      const input = form.value?.querySelector("input");
      if (input) {
        input.focus();
        input.select();
      } else {
        primary.value?.focus();
      }
    });
  },
);

function submit() {
  if (promptValue.value.trim()) {
    notification.answerPrompt(promptValue.value);
  }
}

function closeAlert() {
  notification.closeAlert();
}

function answer(value: boolean) {
  notification.answerConfirm(value);
}

function cancel() {
  if (promptOptions.value) {
    notification.answerPrompt(null);
  } else if (confirmation.value) {
    answer(false);
  } else {
    closeAlert();
  }
}
</script>
