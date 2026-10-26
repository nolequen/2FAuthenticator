<template>
  <div>
    <a-file-input
      accept="image/*"
      multiple
      :label="i18n.import_qr_choose"
      :description="i18n.import_backup_qr_in_batches"
      :button="i18n.choose_images"
      @change="importQr($event, true)"
    />
  </div>
</template>
<script setup lang="ts">
// @ts-expect-error - no typings
import QRCode from "qrcode-reader";
import jsQR from "jsqr";
import { getEntryDataFromOTPAuthPerLine } from "../../models/otpauth";
import { importUnderSession } from "../../models/session";
import { i18n } from "../../store/i18n";

async function importQr(event: Event, closeWindow: boolean) {
  const target = event.target as HTMLInputElement;
  if (!target || !target.files) {
    return;
  }
  if (target.files.length) {
    const otpUrlList: string[] = [];
    let hasFailedResults = false;
    for (let fileIndex = 0; fileIndex < target.files.length; fileIndex++) {
      const file = target.files[fileIndex];
      const otpUrl = await getOtpUrlFromQrFile(file);
      if (otpUrl !== null) {
        otpUrlList.push(otpUrl);
      } else {
        hasFailedResults = true;
      }
    }

    const result = await getEntryDataFromOTPAuthPerLine(otpUrlList.join("\n"));

    const importData: { [hash: string]: RawOTPStorage } = result.exportData;

    const { failedCount, succeededCount } = result;

    const decryptedFileData: { [hash: string]: RawOTPStorage } = importData;

    if (Object.keys(decryptedFileData).length) {
      if (!(await importUnderSession(decryptedFileData))) {
        alert(i18n.phrase_incorrect);
        target.value = "";
        return;
      }

      if (hasFailedResults) {
        alert(i18n.import_backup_qr_partly_failed);
      } else if (failedCount && succeededCount) {
        alert(i18n.migration_partly_fail);
      } else if (succeededCount) {
        alert(i18n.updateSuccess);
      } else {
        alert(i18n.migration_fail);
      }

      if (closeWindow) {
        window.close();
      }
    } else {
      alert(i18n.errorqr);
      if (closeWindow) {
        window.close();
      }
    }
  } else {
    alert(i18n.updateFailure);
    if (closeWindow) {
      window.alert(i18n.updateFailure);
      window.close();
    }
  }
  return;
}

async function getOtpUrlFromQrFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = reader.result as string;
      const qrReader = new QRCode();
      qrReader.callback = (
        error: string,
        text: {
          result: string;
          points: Array<{
            x: number;
            y: number;
            count: number;
            estimatedModuleSize: number;
          }>;
        },
      ) => {
        if (error) {
          console.error(error);

          const image: HTMLImageElement = document.createElement("img");
          image.onload = () => {
            const canvas: HTMLCanvasElement = document.createElement("canvas");
            const ctx: CanvasRenderingContext2D = canvas.getContext(
              "2d",
            ) as CanvasRenderingContext2D;

            canvas.width = image.width;
            canvas.height = image.height;
            ctx.drawImage(image, 0, 0);

            const qrImageData = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            );
            const jsQrCode = jsQR(
              qrImageData.data,
              canvas.width,
              canvas.height,
            );

            if (jsQrCode && jsQrCode.data) {
              if (
                jsQrCode.data.indexOf("otpauth://") !== 0 &&
                jsQrCode.data.indexOf("otpauth-migration://") !== 0
              ) {
                return resolve(null);
              }
              return resolve(jsQrCode.data);
            } else {
              return resolve(null);
            }
          };
          image.src = imageUrl;
        } else {
          if (
            text.result.indexOf("otpauth://") !== 0 &&
            text.result.indexOf("otpauth-migration://") !== 0
          ) {
            return resolve(null);
          }
          return resolve(text.result);
        }
      };
      qrReader.decode(imageUrl);
    };
    reader.readAsDataURL(file);
  });
}
</script>
