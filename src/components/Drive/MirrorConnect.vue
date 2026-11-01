<template>
  <ol class="drive-steps">
    <li :class="['drive-step', signinStep]">
      <div class="drive-step-head">
        <span class="drive-step-mark">
          <IconCheck v-if="signinStep === 'done'" />
          <span v-else-if="signinStep === 'busy'" class="drive-spinner"></span>
          <template v-else>1</template>
        </span>
        <span class="drive-step-text">
          <span class="drive-step-title">{{ i18n.drive_step_signin }}</span>
          <span class="drive-step-info">{{
            signinStep === "done" ? email : i18n.drive_signin_info
          }}</span>
        </span>
      </div>
      <div v-if="signinStep === 'active'" class="drive-step-body">
        <p class="drive-step-info">{{ i18n.mirror_consent_info }}</p>
        <div v-if="signinError" class="notice warning" role="alert">
          <IconTriangle />
          <span>{{ signinError }}</span>
        </div>
        <div>
          <a-button variant="primary" @click="signInClick()">
            {{ i18n.drive_signin_google }}
          </a-button>
        </div>
      </div>
    </li>
    <li v-if="setup" :class="['drive-step', browserStep]">
      <div class="drive-step-head">
        <span class="drive-step-mark">
          <IconCheck v-if="browserStep === 'done'" />
          <span v-else-if="browserStep === 'busy'" class="drive-spinner"></span>
          <template v-else>2</template>
        </span>
        <span class="drive-step-text">
          <span class="drive-step-title">{{ i18n.mirror_step_browser }}</span>
          <span class="drive-step-info">{{
            browserStep === "done" && source
              ? browserName(source)
              : i18n.mirror_step_browser_info
          }}</span>
        </span>
      </div>
      <div v-if="browserStep === 'active'" class="drive-step-body">
        <div v-if="browserError" class="notice warning" role="alert">
          <IconTriangle />
          <span>{{ browserError }}</span>
        </div>
        <div
          v-if="sources.length"
          class="mirror-sources"
          role="radiogroup"
          :aria-label="i18n.mirror_step_browser"
        >
          <label v-for="item in sources" :key="item.id" class="mirror-source">
            <input
              v-model="chosen"
              type="radio"
              name="mirror-source"
              :value="item.id"
            />
            <span class="mirror-source-text">
              <span class="mirror-source-name">{{
                browserName(item.browser)
              }}</span>
              <span class="mirror-source-meta">{{ sourceMeta(item) }}</span>
            </span>
          </label>
        </div>
        <div>
          <a-button v-if="sources.length" variant="primary" @click="choose()">
            {{ i18n.mirror_choose }}
          </a-button>
          <a-button v-else variant="primary" @click="loadSources()">
            {{ i18n.drive_retry }}
          </a-button>
        </div>
      </div>
    </li>
    <li v-if="setup" :class="['drive-step', passwordStep]">
      <div class="drive-step-head">
        <span class="drive-step-mark">
          <IconCheck v-if="passwordStep === 'done'" />
          <span
            v-else-if="passwordStep === 'busy'"
            class="drive-spinner"
          ></span>
          <template v-else>3</template>
        </span>
        <span class="drive-step-text">
          <span class="drive-step-title">{{ i18n.drive_copy_password }}</span>
        </span>
      </div>
      <MirrorPasswordForm
        v-if="passwordStep === 'active'"
        class="drive-step-body"
        :error="passwordError"
        :existing="existing"
        @submit="unlock($event)"
      />
    </li>
    <li :class="['drive-step', codesStep]">
      <div class="drive-step-head">
        <span class="drive-step-mark">
          <IconCheck v-if="codesStep === 'done'" />
          <span v-else-if="codesStep === 'busy'" class="drive-spinner"></span>
          <template v-else>{{ setup ? 4 : 2 }}</template>
        </span>
        <span class="drive-step-text">
          <span class="drive-step-title">{{ i18n.mirror_step_codes }}</span>
          <span v-if="codesMessage" class="drive-step-info" role="status">{{
            codesMessage
          }}</span>
        </span>
      </div>
      <div v-if="codesStep === 'active'" class="drive-step-body">
        <div>
          <a-button variant="primary" @click="applyCopy()">
            {{ i18n.drive_retry }}
          </a-button>
        </div>
      </div>
    </li>
  </ol>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { DriveApi } from "../../drive/api";
import { driveClient, requestDataCollection, signIn } from "../../drive/auth";
import { DRIVE_MIRROR_LOCK } from "../../drive/config";
import { connectedRecord, sameAccount } from "../../drive/connect";
import { accountsCount, browserName, formatMoment } from "../../drive/display";
import type { Backup, DriveCopyInfo } from "../../drive/mirror";
import {
  type DriveBrowser,
  isMirror,
  readDriveRecord,
  writeDriveRecord,
  writeDriveSession,
} from "../../drive/state";
import { attentionText, errorText, mirrorResultText } from "../../drive/status";
import { EntryStorage } from "../../models/storage";
import { i18n, t } from "../../store/i18n";
import { type MirrorUnlockResult, useDriveStore } from "../../store/Drive";
import MirrorPasswordForm from "./MirrorPasswordForm.vue";

import IconCheck from "lucide-static/icons/check.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";

type StepState = "todo" | "active" | "busy" | "done";

const props = defineProps<{ signin?: boolean }>();

const drive = useDriveStore();
const signinStep = ref<StepState>("active");
const browserStep = ref<StepState>("todo");
const passwordStep = ref<StepState>("todo");
const codesStep = ref<StepState>("todo");
const setup = ref(!props.signin);
const email = ref("");
const signinError = ref("");
const browserError = ref("");
const sources = ref<DriveCopyInfo[]>([]);
const chosen = ref("");
const source = ref<DriveBrowser>();
const existing = ref(0);
const passwordError = ref<string>();
const codesMessage = ref("");
let copy: Backup | null = null;
let replace = false;
let undecrypted = 0;

function sourceMeta(item: DriveCopyInfo) {
  return [
    t("mirror_copy_time", formatMoment(Date.parse(item.modifiedTime))),
    accountsCount(item.accounts),
  ].join(" · ");
}

function signInClick() {
  connect(requestDataCollection());
}

async function connect(permitted: Promise<boolean>) {
  signinError.value = "";
  signinStep.value = "busy";
  try {
    if (!(await permitted)) {
      signinError.value = i18n.mirror_permission_denied;
      signinStep.value = "active";
      return;
    }
    const started = await readDriveRecord();
    const result = await signIn(driveClient(), started?.email);
    const address = await new DriveApi(async () => result.session.accessToken)
      .email()
      .catch(() => undefined);
    if (!address) {
      signinError.value = i18n.drive_signin_failed;
      signinStep.value = "active";
      return;
    }
    const record = await navigator.locks.request(
      DRIVE_MIRROR_LOCK,
      async () => {
        const previous = await readDriveRecord();
        const written = await writeDriveRecord((current) =>
          started && !current
            ? null
            : connectedRecord(current, address, result.refreshToken, true),
        );
        if (written && previous && !sameAccount(previous, address)) {
          await EntryStorage.clearAll();
        }
        return written;
      },
    );
    if (!record) {
      signinError.value = i18n.drive_signin_failed;
      signinStep.value = "active";
      return;
    }
    await writeDriveSession({
      ...result.session,
      connectionId: record.connectionId,
    });
    await drive.refresh();
    email.value = record.email ?? "";
    signinStep.value = "done";
  } catch (error) {
    console.warn(error);
    signinError.value = i18n.drive_signin_failed;
    signinStep.value = "active";
    return;
  }

  if (drive.record?.mirror?.source) {
    await applyCopy();
  } else {
    setup.value = true;
    await loadSources();
  }
}

onMounted(async () => {
  if (props.signin) {
    return;
  }
  const current = await readDriveRecord();
  if (
    signinStep.value === "active" &&
    isMirror(current) &&
    !current.mirror.source &&
    current.refreshToken
  ) {
    email.value = current.email ?? "";
    signinStep.value = "done";
    await loadSources();
  }
});

async function loadSources() {
  browserError.value = "";
  browserStep.value = "busy";
  try {
    const response = await drive.mirrorSources();
    if ("error" in response) {
      browserError.value = errorText(response.error);
      browserStep.value = "active";
      return;
    }
    if (!response.sources.length) {
      await drive.disconnect();
      browserStep.value = "todo";
      signinError.value = t("mirror_no_copies", email.value || "Google");
      signinStep.value = "active";
      return;
    }
    sources.value = response.sources;
    chosen.value = response.sources[0].id;
    browserStep.value = "active";
  } catch (error) {
    console.warn(error);
    browserError.value = i18n.updateFailure;
    browserStep.value = "active";
  }
}

async function choose() {
  const selected = sources.value.find((item) => item.id === chosen.value);
  if (!selected) {
    return;
  }
  browserError.value = "";
  browserStep.value = "busy";
  try {
    const response = await drive.mirrorCopy(selected.id);
    if ("error" in response) {
      browserError.value =
        response.error === "invalid"
          ? i18n.updateFailure
          : errorText(response.error);
      browserStep.value = "active";
      return;
    }
    copy = response.copy;
    source.value = selected.browser as DriveBrowser;
    existing.value = await EntryStorage.count();
    replace = existing.value > 0 || (await EntryStorage.hasEncryptionKey());
    browserStep.value = "done";
    if (response.unknown.length) {
      passwordError.value = undefined;
      passwordStep.value = "active";
      return;
    }
  } catch (error) {
    console.warn(error);
    browserError.value = i18n.updateFailure;
    browserStep.value = "active";
    return;
  }
  await unlock(null);
}

async function unlock(value: string | null) {
  if (!copy || !source.value || value === "") {
    return;
  }
  passwordError.value = undefined;
  passwordStep.value = "busy";
  let result: MirrorUnlockResult;
  try {
    result = await drive.unlockMirror(copy, value, {
      source: source.value,
      replace,
    });
  } catch (error) {
    console.warn(error);
    if (value === null) {
      passwordStep.value = "todo";
      browserError.value = i18n.updateFailure;
      browserStep.value = "active";
    } else {
      passwordError.value = i18n.updateFailure;
      passwordStep.value = "active";
    }
    return;
  }
  if (result.status === "wrongPassword") {
    passwordError.value = i18n.drive_wrong_password;
    passwordStep.value = "active";
    return;
  }
  if (result.status === "disconnected") {
    passwordStep.value = "todo";
    browserStep.value = "todo";
    signinError.value = i18n.drive_signin_failed;
    signinStep.value = "active";
    return;
  }
  passwordStep.value = "done";
  replace = false;
  undecrypted = result.undecrypted;
  await applyCopy();
}

async function applyCopy() {
  codesStep.value = "busy";
  codesMessage.value = "";
  const result = await drive.mirrorCheck(true).catch(() => undefined);
  switch (result?.status) {
    case "applied":
    case "unchanged":
    case "none":
      codesStep.value = "done";
      codesMessage.value = [
        undecrypted ? t("mirror_undecrypted", String(undecrypted)) : "",
        i18n.drive_done,
      ]
        .filter(Boolean)
        .join(". ");
      return;
    case "attention":
      codesStep.value = "done";
      codesMessage.value = attentionText(result.attention);
      return;
    default:
      codesStep.value = "active";
      codesMessage.value = mirrorResultText(result);
  }
}
</script>
