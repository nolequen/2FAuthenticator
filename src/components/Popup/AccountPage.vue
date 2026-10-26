<template>
  <div>
    <a-page-header :title="i18n.account" @back="currentView.back()" />
    <div v-if="entry" class="page-body">
      <div class="account-summary">
        <EntryAvatar :issuer="entry.issuer" :hash="entry.hash" large />
        <div class="account-summary-text">
          <div class="account-title">{{ title }}</div>
          <div v-if="decrypted" class="account-params">{{ params }}</div>
        </div>
      </div>
      <div class="panel padded">
        <a-text-input
          v-model="name"
          class="issuer-field"
          :label="i18n.issuer"
          :readonly="!decrypted"
          @change="save()"
        />
        <a-text-input
          v-model="entry.account"
          class="account-field"
          :label="i18n.accountName"
          :readonly="!decrypted"
          @change="save()"
        />
        <a-text-input
          v-model="site"
          class="site-field"
          :label="i18n.site"
          :optional="i18n.optional"
          placeholder="github.com"
          :readonly="!decrypted"
          :error="siteError"
          :spellcheck="false"
          @change="save()"
        />
      </div>
      <div v-if="decrypted" class="panel">
        <a-toggle-input
          :model-value="entry.pinned"
          :label="i18n.pin"
          @change="actions.togglePin(entry)"
        >
          <template #icon><IconPin /></template>
        </a-toggle-input>
        <a-toggle-input
          v-if="menu.siteIcons && faviconUrl(issuerSite(entry.issuer))"
          class="site-icon-toggle"
          :model-value="!menu.siteIconsOff.includes(entry.hash)"
          :label="i18n.site_icon"
          @change="menu.setSiteIcon(entry.hash, $event)"
        >
          <template #icon><IconGlobe /></template>
        </a-toggle-input>
        <button
          type="button"
          class="row show-qr"
          @click="actions.showQr(entry)"
        >
          <IconQr />
          <span class="row-text">{{ i18n.show_qr }}</span>
          <IconChevronRight class="row-trail" />
        </button>
      </div>
      <div v-else class="notice info">
        <IconInfo />
        <span>{{ i18n.account_locked_hint }}</span>
      </div>
      <button
        type="button"
        class="button danger-soft block delete-account"
        @click="remove()"
      >
        <IconTrash />{{ i18n.delete_account }}
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { OTPType } from "../../models/otp";
import {
  algorithmName,
  faviconUrl,
  issuerName,
  issuerSite,
  joinIssuer,
  normalizeSite,
} from "../../display";
import { i18n, t } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useMenuStore } from "../../store/Menu";
import { useEntryActions } from "./entryActions";
import EntryAvatar from "./EntryAvatar.vue";

import IconPin from "lucide-static/icons/pin.svg";
import IconGlobe from "lucide-static/icons/globe.svg";
import IconQr from "lucide-static/icons/qr-code.svg";
import IconChevronRight from "lucide-static/icons/chevron-right.svg";
import IconInfo from "lucide-static/icons/info.svg";
import IconTrash from "lucide-static/icons/trash.svg";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const menu = useMenuStore();
const actions = useEntryActions();

const entry = computed(() =>
  accounts.entries.find((item) => item.hash === currentView.accountHash),
);
const decrypted = computed(() => entry.value?.secret !== null);
const title = computed(() =>
  entry.value ? issuerName(entry.value.issuer) || entry.value.account : "",
);
const name = ref("");
const site = ref("");
const siteError = ref("");

const params = computed(() => {
  if (!entry.value) {
    return "";
  }
  const counter =
    entry.value.type === OTPType.hotp || entry.value.type === OTPType.hhex;
  return [
    counter ? "HOTP" : "TOTP",
    t("params_digits", String(entry.value.digits)),
    counter ? "" : t("params_period", String(entry.value.period)),
    algorithmName(entry.value.algorithm),
  ]
    .filter((part) => part)
    .join(" · ");
});

watch(
  entry,
  (current) => {
    const issuer = current?.issuer ?? "";
    name.value = issuerName(issuer);
    site.value = issuerSite(issuer);
    siteError.value = "";
  },
  { immediate: true },
);

watch(entry, (current) => {
  if (!current && currentView.current === "Account") {
    currentView.back();
  }
});

async function save() {
  const target = entry.value;
  if (!target) {
    return;
  }
  const stored = issuerSite(target.issuer);
  const host =
    site.value.trim().toLowerCase() === stored
      ? stored
      : normalizeSite(site.value);
  siteError.value = host === null ? i18n.site_invalid : "";
  target.issuer = joinIssuer(name.value, host ?? stored);
  name.value = issuerName(target.issuer);
  if (host !== null) {
    site.value = host;
  }
  try {
    await target.update();
  } catch (error) {
    await accounts.showWriteFailure(error);
  }
}

async function remove() {
  const target = entry.value;
  if (!target || !(await actions.remove(target))) {
    return;
  }
  if (currentView.current === "Account") {
    currentView.back();
  }
}
</script>
