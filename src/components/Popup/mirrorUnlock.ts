import type { Backup } from "../../drive/mirror";
import type { DriveBrowser } from "../../drive/state";
import { errorText, mirrorResultText } from "../../drive/status";
import { i18n, t } from "../../store/i18n";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import { useNotificationStore } from "../../store/Notification";

export function useMirrorUnlock() {
  const currentView = useCurrentViewStore();
  const drive = useDriveStore();
  const notification = useNotificationStore();

  async function openCopy(fileId: string) {
    const response = await currentView
      .withBusy(() => drive.mirrorCopy(fileId))
      .catch((error) => {
        console.warn(error);
        return { error: "invalid" as const };
      });
    if ("error" in response) {
      notification.alert(
        response.error === "invalid"
          ? i18n.updateFailure
          : errorText(response.error),
      );
      return null;
    }
    return response;
  }

  async function unlock(
    copy: Backup,
    password: string | null,
    source?: DriveBrowser,
  ) {
    const result = await currentView
      .withBusy(() => drive.unlockMirror(copy, password, { source }))
      .catch((error) => {
        console.warn(error);
        return null;
      });
    if (!result) {
      notification.alert(i18n.updateFailure);
      return true;
    }
    if (result.status === "wrongPassword") {
      return false;
    }
    currentView.close();
    if (result.status === "disconnected") {
      return true;
    }
    const check = await currentView
      .withBusy(() => drive.mirrorCheck(true))
      .catch(() => undefined);
    if (result.undecrypted) {
      notification.alert(t("mirror_undecrypted", String(result.undecrypted)));
    } else if (
      check?.status === "applied" ||
      check?.status === "unchanged" ||
      check?.status === "none" ||
      check?.status === "attention"
    ) {
      notification.ephermalMessage(mirrorResultText(check));
    } else {
      notification.alert(mirrorResultText(check));
    }
    return true;
  }

  return { openCopy, unlock };
}
