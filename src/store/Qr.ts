import { defineStore } from "pinia";
import { ref } from "vue";

export const useQrStore = defineStore("qr", () => {
  const qr = ref("");

  function setQr(url: string) {
    qr.value = `url(${url})`;
  }

  return { qr, setQr };
});
