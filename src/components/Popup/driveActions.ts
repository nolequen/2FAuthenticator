import { computed } from "vue";
import { isMirror } from "../../drive/state";
import { i18n, t } from "../../store/i18n";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import { useNotificationStore } from "../../store/Notification";

export function useDriveActions() {
  const currentView = useCurrentViewStore();
  const drive = useDriveStore();
  const notification = useNotificationStore();

  const web = computed(() => drive.record?.client === "web");
  const signOutLabel = computed(() =>
    web.value ? i18n.drive_sign_out_web : i18n.drive_sign_out,
  );

  async function disconnect() {
    if (
      await notification.confirm({
        title: i18n.drive_disconnect_title,
        message: isMirror(drive.record)
          ? i18n.mirror_disconnect_text
          : t("drive_disconnect_text", signOutLabel.value),
        confirm: i18n.drive_disconnect,
        danger: true,
      })
    ) {
      await currentView.withBusy(() => drive.disconnect());
    }
  }

  async function signOutEverywhere() {
    if (
      await notification.confirm({
        title: web.value
          ? i18n.drive_sign_out_web_title
          : i18n.drive_sign_out_title,
        message: web.value
          ? i18n.drive_sign_out_web_text
          : i18n.drive_sign_out_text,
        confirm: signOutLabel.value,
        danger: true,
      })
    ) {
      if (!(await currentView.withBusy(() => drive.signOutEverywhere()))) {
        notification.alert(i18n.drive_sign_out_failed);
      }
    }
  }

  return { signOutLabel, disconnect, signOutEverywhere };
}
