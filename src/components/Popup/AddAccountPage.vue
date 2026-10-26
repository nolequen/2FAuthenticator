<template>
  <div>
    <a-page-header :title="i18n.add_secret" @back="currentView.back()" />
    <div class="page-body">
      <div class="panel padded">
        <a-text-input v-model="newAccount.issuer" :label="i18n.issuer" />
        <a-text-input
          v-model="newAccount.secret"
          class="mono"
          :label="i18n.secret"
          :spellcheck="false"
        />
        <a-text-input
          v-model="newAccount.account"
          :label="i18n.accountName"
          :optional="i18n.optional"
          :placeholder="i18n.account_placeholder"
        />
      </div>
      <details class="panel advanced">
        <summary>
          <span>{{ i18n.advanced }}</span>
          <IconChevronDown class="row-trail" />
        </summary>
        <div class="advanced-body">
          <a-segmented-input
            v-model="newAccount.type"
            :label="i18n.type"
            :options="[
              { value: OTPType.totp, label: i18n.based_on_time },
              { value: OTPType.hotp, label: i18n.based_on_counter },
            ]"
          />
          <div class="field-row">
            <a-select-input
              v-model.number="newAccount.digits"
              :label="i18n.digits"
            >
              <option value="6">6</option>
              <option value="8">8</option>
            </a-select-input>
            <div class="field">
              <label class="field-label" for="period">{{ i18n.period }}</label>
              <input
                id="period"
                v-model.number="newAccount.period"
                type="number"
                min="1"
                placeholder="30"
                class="input"
                :disabled="newAccount.type === OTPType.hotp"
              />
            </div>
            <a-select-input
              v-model.number="newAccount.algorithm"
              :label="i18n.algorithm"
            >
              <option
                v-for="algorithm in algorithms"
                :key="algorithm"
                :value="algorithm"
              >
                {{ algorithmName(algorithm) }}
              </option>
            </a-select-input>
          </div>
        </div>
      </details>
    </div>
    <div class="page-footer">
      <a-button
        class="add-account"
        variant="primary"
        block
        @click="addNewAccount()"
        >{{ i18n.add }}</a-button
      >
    </div>
  </div>
</template>
<script setup lang="ts">
import { reactive } from "vue";
import { OTPType, OTPEntry, OTPAlgorithm } from "../../models/otp";
import { algorithmName } from "../../display";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useNotificationStore } from "../../store/Notification";

import IconChevronDown from "lucide-static/icons/chevron-down.svg";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();

const algorithms = [
  OTPAlgorithm.SHA1,
  OTPAlgorithm.SHA256,
  OTPAlgorithm.SHA512,
  OTPAlgorithm.GOST3411_2012_256,
  OTPAlgorithm.GOST3411_2012_512,
];

const newAccount: {
  issuer: string;
  account: string;
  secret: string;
  type: OTPType;
  period: number | undefined;
  digits: number;
  algorithm: OTPAlgorithm;
} = reactive({
  issuer: "",
  account: "",
  secret: "",
  type: OTPType.totp,
  period: undefined,
  digits: 6,
  algorithm: OTPAlgorithm.SHA1,
});

async function addNewAccount() {
  newAccount.secret = newAccount.secret.replace(/ /g, "");

  if (newAccount.secret.length < 16) {
    notification.alert(i18n.errorsecret);
    return;
  }

  if (
    !/^[a-z2-7]+=*$/i.test(newAccount.secret) &&
    !/^[0-9a-f]+$/i.test(newAccount.secret)
  ) {
    notification.alert(i18n.errorsecret);
    return;
  }
  let type: OTPType;
  if (
    !/^[a-z2-7]+=*$/i.test(newAccount.secret) &&
    /^[0-9a-f]+$/i.test(newAccount.secret) &&
    newAccount.type === OTPType.totp
  ) {
    type = OTPType.hex;
  } else if (
    !/^[a-z2-7]+=*$/i.test(newAccount.secret) &&
    /^[0-9a-f]+$/i.test(newAccount.secret) &&
    newAccount.type === OTPType.hotp
  ) {
    type = OTPType.hhex;
  } else {
    type = newAccount.type;
  }

  if (type === OTPType.hhex || type === OTPType.hotp) {
    newAccount.period = undefined;
  } else if (typeof newAccount.period !== "number" || newAccount.period < 1) {
    newAccount.period = undefined;
  }

  const encryption = accounts.encryption.get(accounts.defaultEncryption);

  const entry = new OTPEntry(
    {
      type,
      index: 0,
      issuer: newAccount.issuer,
      account: newAccount.account,
      encrypted: false,
      secret: newAccount.secret,
      counter: 0,
      period: newAccount.period,
      digits: newAccount.digits,
      algorithm: newAccount.algorithm,
    },
    encryption,
  );

  try {
    await entry.create();
  } catch (error) {
    await accounts.showWriteFailure(error);
    return;
  }
  accounts.addCode(entry);
  currentView.close();

  const codes = document.getElementById("codes");
  if (codes) {
    // wait vue apply changes to dom
    setTimeout(() => {
      codes.scrollTop = 0;
    }, 0);
  }
  return;
}
</script>
