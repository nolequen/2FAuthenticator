export function getAlertText(message: {
  action: string;
  secret?: string;
  account?: string;
  text?: string;
}) {
  switch (message.action) {
    case "errorqr":
      return chrome.i18n.getMessage("errorqr");
    case "secretqr":
      return `${chrome.i18n.getMessage("errorsecret")}\n${message.secret}`;
    case "errorenc":
      return chrome.i18n.getMessage("phrase_incorrect");
    case "added":
      return message.account + chrome.i18n.getMessage("added");
    case "text":
      return message.text;
    case "migrationfail":
      return chrome.i18n.getMessage("migration_fail");
    case "migrationpartlyfail":
      return chrome.i18n.getMessage("migration_partly_fail");
    case "migrationsuccess":
      return chrome.i18n.getMessage("updateSuccess");
    default:
      return undefined;
  }
}
