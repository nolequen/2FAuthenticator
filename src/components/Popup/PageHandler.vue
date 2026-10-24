<template>
  <div id="info">
    <div
      id="infoClose"
      v-if="!(info === 'EnterPasswordPage' || info === 'LoadingPage')"
      v-on:click="hideInfo()"
    >
      <IconXCircle />
    </div>
    <component v-bind:is="pages[info]" id="infoContent"></component>
  </div>
</template>
<script setup lang="ts">
import type { Component } from "vue";
import { storeToRefs } from "pinia";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useStyleStore } from "../../store/Style";

import IconXCircle from "../../../svg/x-circle.svg";

import AddAccountPage from "./AddAccountPage.vue";
import AddMethodPage from "./AddMethodPage.vue";
import SetPasswordPage from "./SetPasswordPage.vue";
import EnterPasswordPage from "./EnterPasswordPage.vue";
import BackupPage from "./BackupPage.vue";
import PreferencesPage from "./PreferencesPage.vue";
import LoadingPage from "./LoadingPage.vue";

const pages: { [name: string]: Component } = {
  AddAccountPage,
  AddMethodPage,
  SetPasswordPage,
  EnterPasswordPage,
  BackupPage,
  PreferencesPage,
  LoadingPage,
};

const styleStore = useStyleStore();
const { info } = storeToRefs(useCurrentViewStore());

function hideInfo() {
  styleStore.hideInfo();
}
</script>
