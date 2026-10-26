export type Theme = "auto" | "light" | "dark";

export function normalizeTheme(value: unknown): Theme {
  switch (value) {
    case "auto":
    case "light":
    case "dark":
      return value;
    case "accessibility":
      return "dark";
    case "normal":
    case "simple":
    case "compact":
    case "flat":
      return "light";
    default:
      return "auto";
  }
}

export function applyTheme(theme: Theme) {
  if (theme === "auto") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function trackInputModality() {
  document.addEventListener(
    "keydown",
    () => document.documentElement.classList.add("kbd"),
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => document.documentElement.classList.remove("kbd"),
    true,
  );
}
