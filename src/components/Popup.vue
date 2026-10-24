<template>
  <div
    v-cloak
    v-bind:class="{
      'theme-normal':
        theme !== 'accessibility' &&
        theme !== 'dark' &&
        theme !== 'simple' &&
        theme !== 'compact' &&
        theme !== 'flat',
      'theme-accessibility': theme === 'accessibility',
      'theme-dark': theme === 'dark',
      'theme-simple': theme === 'simple',
      'theme-compact': theme === 'compact',
      'theme-flat': theme === 'flat',
      hideoutline,
    }"
    v-on:mousedown="hideoutline = true"
    v-on:keydown="hideoutline = false"
  >
    <MainHeader />
    <MainBody
      v-bind:class="{
        timeout: style.timeout && !style.isEditing,
        edit: style.isEditing,
      }"
    />

    <MenuPage
      id="menu"
      v-show="style.slidein || style.slideout"
      v-bind:class="{ slidein: style.slidein, slideout: style.slideout }"
    />

    <PageHandler
      v-bind:class="{
        fadein: style.fadein,
        fadeout: style.fadeout,
        show: style.show,
      }"
    />

    <NotificationHandler />

    <!-- EPHERMAL MESSAGE -->
    <div
      id="notification"
      v-bind:class="{
        fadein: style.notificationFadein,
        fadeout: style.notificationFadeout,
      }"
    >
      {{ notification }}
    </div>

    <!-- QR -->
    <div
      id="qr"
      v-bind:class="{ qrfadein: style.qrfadein, qrfadeout: style.qrfadeout }"
      v-bind:style="{ 'background-image': qr }"
      v-on:click="hideQr()"
    ></div>

    <!-- CLIPBOARD -->
    <input type="text" id="codeClipboard" tabindex="-1" />
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";

import MainHeader from "./Popup/MainHeader.vue";
import MainBody from "./Popup/MainBody.vue";
import MenuPage from "./Popup/MenuPage.vue";
import PageHandler from "./Popup/PageHandler.vue";
import NotificationHandler from "./Popup/NotificationHandler.vue";
import { useMenuStore } from "../store/Menu";
import { useNotificationStore } from "../store/Notification";
import { useQrStore } from "../store/Qr";
import { useStyleStore } from "../store/Style";

const styleStore = useStyleStore();
const { style } = storeToRefs(styleStore);
const { theme } = storeToRefs(useMenuStore());
const { qr } = storeToRefs(useQrStore());
const { notification } = storeToRefs(useNotificationStore());

const hideoutline = ref(true);

function hideQr() {
  styleStore.hideQr();
}
</script>
