export function focusFirstCard() {
  (
    document.querySelector<HTMLElement>(".entry[tabindex='0']") ??
    document.getElementById("i-plus")
  )?.focus();
}
