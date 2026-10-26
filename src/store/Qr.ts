import { defineStore } from "pinia";
import { ref } from "vue";

export interface QrCode {
  url: string;
  issuer: string;
  account: string;
}

export const useQrStore = defineStore("qr", () => {
  const qr = ref<QrCode | null>(null);

  function setQr(code: QrCode) {
    qr.value = code;
  }

  function hideQr() {
    qr.value = null;
  }

  return { qr, setQr, hideQr };
});
