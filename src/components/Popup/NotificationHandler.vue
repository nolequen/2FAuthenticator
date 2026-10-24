<template>
  <div>
    <!-- MESSAGE -->
    <div class="message-box" v-show="message.length && messageIdle">
      <div>{{ message.length ? message[0] : "" }}</div>
      <a-button type="small" @click="closeAlert()">{{ i18n.ok }}</a-button>
    </div>

    <!-- CONFIRM -->
    <div class="message-box" v-show="confirmMessage !== ''">
      <div>{{ confirmMessage }}</div>
      <div class="buttons">
        <a-button type="small" @click="answerConfirm(true)">{{
          i18n.yes
        }}</a-button>
        <a-button type="small" @click="answerConfirm(false)">
          {{ i18n.no }}
        </a-button>
      </div>
    </div>

    <!-- OVERLAY -->
    <div
      id="overlay"
      v-show="(message.length && messageIdle) || confirmMessage !== ''"
    ></div>
  </div>
</template>
<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useNotificationStore } from "../../store/Notification";

const notification = useNotificationStore();
const { message, messageIdle, confirmMessage } = storeToRefs(notification);

function closeAlert() {
  notification.closeAlert();
}

function answerConfirm(answer: boolean) {
  notification.answerConfirm(answer);
}
</script>
