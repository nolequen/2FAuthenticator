<template>
  <div class="lock-screen" @keydown.stop>
    <header class="bar">
      <h1 class="bar-title">{{ i18n.extName }}</h1>
    </header>
    <div class="lock-form">
      <div class="hero-icon"><IconLock /></div>
      <div class="hero-text">
        <h2>{{ i18n.locked_title }}</h2>
        <p>{{ i18n.passphrase_info }}</p>
      </div>
      <a-text-input
        v-model="password"
        type="password"
        :label="i18n.phrase"
        :error="wrongPassword ? i18n.phrase_wrong : undefined"
        :autofocus="true"
        @enter="applyPassphrase()"
      />
      <a-button variant="primary" block @click="applyPassphrase()">
        {{ i18n.unlock }}
      </a-button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useAccountsStore } from "../../store/Accounts";

import IconLock from "lucide-static/icons/lock.svg";

const accounts = useAccountsStore();
const { wrongPassword } = storeToRefs(accounts);

const password = ref("");

async function applyPassphrase() {
  await accounts.applyPassphrase(password.value);
}
</script>
