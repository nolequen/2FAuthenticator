<template>
  <div>
    <a-page-header
      :title="i18n.mirror_change_browser"
      @back="currentView.back()"
    />
    <div class="page-body">
      <p class="drive-note">{{ i18n.mirror_step_browser_info }}</p>
      <div v-if="loading" class="drive-loading" role="status">
        <div class="spinner" :aria-label="i18n.loading"></div>
      </div>
      <div v-else-if="error" class="notice warning">
        <IconTriangle />
        <span>{{ error }}</span>
      </div>
      <p v-else-if="!sources.length" class="drive-note">
        {{ t("mirror_no_copies", drive.record?.email || "Google") }}
      </p>
      <button
        v-for="item in sources"
        :key="item.id"
        type="button"
        class="option drive-copy"
        :aria-current="item.browser === current || undefined"
        @click="choose(item)"
      >
        <span
          :class="['drive-copy-icon', { latest: item.browser === current }]"
        >
          <IconCheck v-if="item.browser === current" />
          <IconGlobe v-else />
        </span>
        <span class="row-text">
          <span class="option-title">{{ browserName(item.browser) }}</span>
          <span class="row-subtitle">{{ meta(item) }}</span>
        </span>
        <IconChevronRight class="row-trail" />
      </button>
      <MirrorPasswordForm
        v-if="selected"
        class="panel padded"
        :error="passwordError"
        small
        @submit="submit($event)"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { accountsCount, browserName, formatMoment } from "../../drive/display";
import type { Backup, DriveCopyInfo } from "../../drive/mirror";
import type { DriveBrowser } from "../../drive/state";
import { errorText } from "../../drive/status";
import { i18n, t } from "../../store/i18n";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import MirrorPasswordForm from "../Drive/MirrorPasswordForm.vue";
import { useMirrorUnlock } from "./mirrorUnlock";

import IconCheck from "lucide-static/icons/check.svg";
import IconChevronRight from "lucide-static/icons/chevron-right.svg";
import IconGlobe from "lucide-static/icons/globe.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";

const currentView = useCurrentViewStore();
const drive = useDriveStore();
const { openCopy, unlock } = useMirrorUnlock();

const loading = ref(true);
const error = ref("");
const sources = ref<DriveCopyInfo[]>([]);
const selected = ref<{ copy: Backup; source: DriveBrowser } | null>(null);
const passwordError = ref<string>();

const current = computed(() => drive.record?.mirror?.source);

onMounted(async () => {
  const response = await drive.mirrorSources();
  loading.value = false;
  if ("error" in response) {
    error.value = errorText(response.error);
    return;
  }
  sources.value = response.sources;
});

function meta(item: DriveCopyInfo) {
  return [
    t("mirror_copy_time", formatMoment(Date.parse(item.modifiedTime))),
    accountsCount(item.accounts),
  ].join(" · ");
}

async function choose(item: DriveCopyInfo) {
  selected.value = null;
  const opened = await openCopy(item.id);
  if (!opened) {
    return;
  }
  const source = item.browser as DriveBrowser;
  if (opened.unknown.length) {
    passwordError.value = undefined;
    selected.value = { copy: opened.copy, source };
    return;
  }
  await unlock(opened.copy, null, source);
}

async function submit(password: string) {
  if (!selected.value) {
    return;
  }
  passwordError.value = undefined;
  if (!(await unlock(selected.value.copy, password, selected.value.source))) {
    passwordError.value = i18n.drive_wrong_password;
  }
}
</script>
