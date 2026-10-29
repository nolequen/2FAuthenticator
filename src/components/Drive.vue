<template>
  <main id="drive" class="tab-page">
    <div class="brand">
      <IconApp class="brand-icon" aria-hidden="true" />
      {{ i18n.extName }}
    </div>
    <div>
      <h1>{{ heading }}</h1>
      <p class="lead">{{ i18n.drive_tab_lead }}</p>
    </div>
    <div v-if="!drive.available" class="notice warning">
      <IconTriangle />
      <span>{{ i18n.drive_unavailable }}</span>
    </div>
    <ol v-else class="drive-steps">
      <li :class="['drive-step', signin]">
        <div class="drive-step-head">
          <span class="drive-step-mark">
            <IconCheck v-if="signin === 'done'" />
            <span v-else-if="signin === 'busy'" class="drive-spinner"></span>
            <template v-else>1</template>
          </span>
          <span class="drive-step-text">
            <span class="drive-step-title">{{
              mode === "consent"
                ? i18n.drive_banner_consent_title
                : i18n.drive_step_signin
            }}</span>
            <span v-if="signinInfo" class="drive-step-info">{{
              signinInfo
            }}</span>
          </span>
        </div>
        <div v-if="signin === 'active'" class="drive-step-body">
          <p v-if="isFirefox" class="drive-step-info">
            {{ i18n.drive_consent_info }}
          </p>
          <div v-if="signinError" class="notice warning" role="alert">
            <IconTriangle />
            <span>{{ signinError }}</span>
          </div>
          <div>
            <a-button
              v-if="mode === 'consent'"
              variant="primary"
              @click="allowClick()"
            >
              {{ i18n.drive_allow }}
            </a-button>
            <a-button v-else variant="primary" @click="signInClick()">
              {{ i18n.drive_signin_google }}
            </a-button>
          </div>
        </div>
      </li>
      <li v-if="!mode" :class="['drive-step', password]">
        <div class="drive-step-head">
          <span class="drive-step-mark">
            <IconCheck v-if="password === 'done'" />
            <template v-else>2</template>
          </span>
          <span class="drive-step-text">
            <span class="drive-step-title">{{ i18n.drive_step_password }}</span>
            <span class="drive-step-info">{{
              hasExtensionPassword
                ? i18n.drive_step_password_set
                : i18n.drive_step_password_info
            }}</span>
          </span>
        </div>
        <BackupPasswordForm
          v-if="password === 'active'"
          class="drive-step-body"
          :password-label="i18n.drive_password_label"
          :repeat-label="i18n.drive_password_again"
          :warning="i18n.drive_password_strength"
          :submit-label="i18n.drive_save_and_upload"
          labelled
          autofocus
          @saved="passwordSaved()"
          @failed="passwordFailed()"
        />
      </li>
      <li :class="['drive-step', upload]">
        <div class="drive-step-head">
          <span class="drive-step-mark">
            <IconCheck v-if="upload === 'done'" />
            <span v-else-if="upload === 'busy'" class="drive-spinner"></span>
            <template v-else>{{ mode ? 2 : 3 }}</template>
          </span>
          <span class="drive-step-text">
            <span class="drive-step-title">{{ i18n.drive_step_upload }}</span>
            <span v-if="uploadMessage" class="drive-step-info" role="status">{{
              uploadMessage
            }}</span>
          </span>
        </div>
        <div v-if="upload === 'active'" class="drive-step-body">
          <template v-if="shrink">
            <p class="drive-step-info">
              {{
                t(
                  "drive_banner_shrink_text",
                  String(shrink.from),
                  String(shrink.to),
                )
              }}
            </p>
            <div class="drive-buttons">
              <a-button variant="primary" @click="decideShrink(true)">
                {{ i18n.save }}
              </a-button>
              <a-button @click="decideShrink(false)">
                {{ i18n.drive_dont_save }}
              </a-button>
            </div>
          </template>
          <div v-else>
            <a-button variant="primary" @click="runUpload()">
              {{ i18n.drive_retry }}
            </a-button>
          </div>
        </div>
      </li>
    </ol>
    <div v-if="copiesFound" class="notice info drive-hint">
      <IconInfo />
      <span>{{ i18n.drive_restore_hint }}</span>
    </div>
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { isEdge, isFirefox } from "../browser";
import { DriveApi } from "../drive/api";
import { driveClient, requestDataCollection, signIn } from "../drive/auth";
import { attentionText, resultText } from "../drive/status";
import {
  type DriveBrowser,
  type DriveRecord,
  readDriveRecord,
  updateDriveRecord,
  writeDriveRecord,
  writeDriveSession,
} from "../drive/state";
import { type BackupResult, scheduleBackup } from "../drive/upload";
import { EntryStorage } from "../models/storage";
import { i18n, t } from "../store/i18n";
import { useDriveStore } from "../store/Drive";
import BackupPasswordForm from "./Drive/BackupPasswordForm.vue";

import IconApp from "../../images/icon.svg";
import IconCheck from "lucide-static/icons/check.svg";
import IconInfo from "lucide-static/icons/info.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";

type StepState = "todo" | "active" | "busy" | "done";

const query = location.search.slice(1);
const mode = query === "signin" || query === "consent" ? query : "";

const drive = useDriveStore();
const signin = ref<StepState>("active");
const password = ref<StepState>("todo");
const upload = ref<StepState>("todo");
const signinError = ref("");
const uploadMessage = ref("");
const email = ref("");
const copiesFound = ref(0);
const hasExtensionPassword = ref(false);
const shrink = ref<{ from: number; to: number } | null>(null);

const heading = computed(() =>
  mode === "signin"
    ? i18n.drive_signin_again
    : mode === "consent"
      ? i18n.drive_banner_consent_title
      : i18n.drive_tab_title,
);

const signinInfo = computed(() => {
  if (signin.value !== "done") {
    return mode === "consent" ? "" : i18n.drive_signin_info;
  }
  return [
    email.value,
    copiesFound.value ? t("drive_copies_found", String(copiesFound.value)) : "",
  ]
    .filter(Boolean)
    .join(" · ");
});

onMounted(async () => {
  await drive.init();
  hasExtensionPassword.value = await EntryStorage.hasEncryptionKey();
});

function driveBrowser(): DriveBrowser {
  return isFirefox ? "firefox" : isEdge ? "edge" : "chrome";
}

function signInClick() {
  connect(requestDataCollection());
}

function allowClick() {
  allow(requestDataCollection());
}

function connectedRecord(
  previous: DriveRecord | null,
  address: string | undefined,
  refreshToken: string | undefined,
): DriveRecord {
  const sameAccount =
    !!previous && (!address || !previous.email || previous.email === address);
  const record: DriveRecord = {
    ...(previous ?? {}),
    connectionId: crypto.randomUUID(),
    client: driveClient(),
    browser: driveBrowser(),
  };
  delete record.attention;
  delete record.error;
  if (!sameAccount) {
    delete record.folderId;
    delete record.lastUpload;
    delete record.skipped;
    delete record.shrinkApproved;
    delete record.shrinkSkipped;
  }
  const accountEmail = address ?? (sameAccount ? previous?.email : undefined);
  if (accountEmail) {
    record.email = accountEmail;
  } else {
    delete record.email;
  }
  if (refreshToken) {
    record.refreshToken = refreshToken;
  } else {
    delete record.refreshToken;
  }
  return record;
}

async function connect(consent: Promise<boolean>) {
  signinError.value = "";
  signin.value = "busy";
  try {
    if (!(await consent)) {
      signinError.value = i18n.drive_consent_denied;
      signin.value = "active";
      return;
    }
    const started = await readDriveRecord();
    const result = await signIn(driveClient(), started?.email);
    const address = await new DriveApi(async () => result.session.accessToken)
      .email()
      .catch(() => undefined);
    const record = await writeDriveRecord((current) =>
      started && !current
        ? null
        : connectedRecord(current, address, result.refreshToken),
    );
    if (!record) {
      signinError.value = i18n.drive_signin_failed;
      signin.value = "active";
      return;
    }
    await writeDriveSession({
      ...result.session,
      connectionId: record.connectionId,
    });
    await scheduleBackup();
    await drive.refresh();
    email.value = record.email ?? "";

    if (!mode) {
      const listed = await drive.listCopies();
      copiesFound.value = listed && "files" in listed ? listed.files.length : 0;
    }
    signin.value = "done";

    if (!mode && !hasExtensionPassword.value && !record.backupKey) {
      password.value = "active";
      return;
    }
    if (!mode) {
      password.value = "done";
    }
  } catch (error) {
    console.warn(error);
    signinError.value = i18n.drive_signin_failed;
    signin.value = "active";
    return;
  }
  await runUpload();
}

async function allow(consent: Promise<boolean>) {
  signinError.value = "";
  signin.value = "busy";
  try {
    if (!(await consent)) {
      signinError.value = i18n.drive_consent_denied;
      signin.value = "active";
      return;
    }
    await updateDriveRecord((changed) => {
      if (changed.attention?.kind === "consent") {
        delete changed.attention;
      }
      return changed;
    });
  } catch (error) {
    console.warn(error);
    signinError.value = i18n.updateFailure;
    signin.value = "active";
    return;
  }
  signin.value = "done";
  await runUpload();
}

async function passwordSaved() {
  password.value = "done";
  await runUpload();
}

function passwordFailed() {
  uploadMessage.value = i18n.updateFailure;
}

function showResult(result: BackupResult | undefined) {
  shrink.value = null;
  switch (result?.status) {
    case "uploaded":
    case "unchanged":
    case "empty":
      upload.value = "done";
      uploadMessage.value = i18n.drive_done;
      return;
    case "attention":
      if (result.attention.kind === "backupPassword" && !mode) {
        upload.value = "todo";
        uploadMessage.value = "";
        password.value = "active";
        return;
      }
      if (result.attention.kind === "shrink") {
        shrink.value = {
          from: result.attention.from,
          to: result.attention.to,
        };
        upload.value = "active";
        uploadMessage.value = "";
        return;
      }
      upload.value = "active";
      uploadMessage.value = attentionText(result.attention);
      return;
    default:
      upload.value = "active";
      uploadMessage.value = resultText(result);
  }
}

async function runUpload() {
  upload.value = "busy";
  uploadMessage.value = "";
  showResult(await drive.backupNow().catch(() => undefined));
}

async function decideShrink(save: boolean) {
  upload.value = "busy";
  const result = await drive.decideShrink(save).catch(() => undefined);
  showResult(save || !result ? result : { status: "unchanged" });
}
</script>
