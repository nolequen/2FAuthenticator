<template>
  <div>
    <h2>{{ i18n.delete_all }}</h2>
    <p>{{ i18n.delete_all_warning }}</p>
    <input type="checkbox" id="checkbox" v-model="deleteConfirm" />
    <label for="checkbox">{{ i18n.confirm_delete_all }}</label>
    <br />
    <br />
    <button v-on:click="deleteEverything()" v-bind:disabled="!deleteConfirm">
      {{ i18n.delete_all }}
    </button>
    <br />
    <p v-show="deleteComplete">{{ i18n.updateSuccess }}</p>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";

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
