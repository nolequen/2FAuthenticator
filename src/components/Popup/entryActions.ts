import { EntryStorage, withStorageLock } from "../../models/storage";
import { getQrUrl } from "../../models/qr";
import { issuerName } from "../../display";
import { i18n, t } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";
import { useQrStore } from "../../store/Qr";

export function useEntryActions() {
  const accounts = useAccountsStore();
  const menu = useMenuStore();
  const notification = useNotificationStore();
  const qrStore = useQrStore();

  async function togglePin(entry: OTPEntryInterface) {
    accounts.pinEntry(entry);
    try {
      await withStorageLock(() => EntryStorage.set(accounts.entries));
    } catch (error) {
      await accounts.showWriteFailure(error);
      return;
    }
    if (entry.pinned) {
      document.getElementById("codes")?.scrollTo(0, 0);
    }
  }

  function showQr(entry: OTPEntryInterface) {
    const name = issuerName(entry.issuer);
    qrStore.setQr({
      url: getQrUrl(entry),
      issuer: name || entry.account,
      account: name ? entry.account : "",
    });
  }

  async function remove(entry: OTPEntryInterface) {
    const name = issuerName(entry.issuer) || entry.account;
    const confirmed = await notification.confirm({
      title: t("delete_account_title", name),
      message: t("confirm_delete", entry.account || name),
      confirm: i18n.delete,
      danger: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      await entry.delete();
    } catch (error) {
      await accounts.showWriteFailure(error);
      return false;
    }
    accounts.deleteCode(entry.hash);
    if (menu.siteIconsOff.includes(entry.hash)) {
      menu.setSiteIcon(entry.hash, true);
    }
    return true;
  }

  return {
    togglePin,
    showQr,
    remove,
  };
}
