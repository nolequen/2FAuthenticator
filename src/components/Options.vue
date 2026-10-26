<template>
  <main class="options">
    <div>
      <h1>{{ i18n.extName }}</h1>
      <p class="options-info">{{ i18n.options_info }}</p>
    </div>
    <section class="danger-zone">
      <div class="danger-heading">
        <span class="danger-icon"><IconTrash /></span>
        <h2>{{ i18n.delete_all }}</h2>
      </div>
      <p>{{ i18n.delete_all_warning }}</p>
      <label class="checkbox" for="checkbox">
        <input id="checkbox" v-model="deleteConfirm" type="checkbox" />
        {{ i18n.confirm_delete_all }}
      </label>
      <div>
        <button
          type="button"
          class="button danger"
          :disabled="!deleteConfirm"
          @click="deleteEverything()"
        >
          {{ i18n.delete_all }}
        </button>
      </div>
      <p v-show="deleteComplete" role="status" class="done">
        {{ i18n.delete_all_done }}
      </p>
    </section>
  </main>
</template>
<script setup lang="ts">
import { ref } from "vue";

import IconTrash from "lucide-static/icons/trash.svg";

const deleteConfirm = ref(false);
const deleteComplete = ref(false);

async function deleteEverything() {
  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();
  chrome.runtime.sendMessage({ action: "lock" });
  deleteConfirm.value = false;
  deleteComplete.value = true;
}
</script>
