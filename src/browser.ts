export const isFirefox = navigator.userAgent.indexOf("Firefox") >= 0;
export const isChromium = navigator.userAgent.indexOf("Chrome") >= 0;
export const isEdge = navigator.userAgent.indexOf("Edg/") >= 0;
export let isAndroid = navigator.userAgent.indexOf("Android") >= 0;

export function setAndroid(android: boolean) {
  isAndroid = android;
}
