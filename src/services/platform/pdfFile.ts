import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativeApp } from './runtime';

export type PdfFileResult = { fileName: string; nativePath?: string; shareOpened?: boolean };

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function persistNativeFile(
  fileName: string,
  data: ArrayBuffer,
  saveInBrowser: () => void,
): Promise<PdfFileResult> {
  if (!isNativeApp()) {
    saveInBrowser();
    return { fileName };
  }

  const result = await Filesystem.writeFile({
    path: fileName,
    data: arrayBufferToBase64(data),
    directory: Directory.Documents,
    recursive: true,
  });

  let shareOpened = false;
  try {
    const availability = await Share.canShare();
    if (availability.value) {
      await Share.share({
        title: fileName,
        url: result.uri,
        dialogTitle: 'Save or open GridVision report',
      });
      shareOpened = true;
    }
  } catch {
    // The report remains safely stored in Documents if the device has no
    // compatible share target or the user dismisses the chooser.
  }
  return { fileName, nativePath: result.uri, shareOpened };
}

export async function persistPdfFile(
  fileName: string,
  data: ArrayBuffer,
  saveInBrowser: () => void,
): Promise<PdfFileResult> {
  return persistNativeFile(fileName, data, saveInBrowser);
}

export async function persistCsvFile(
  fileName: string,
  contents: string,
  saveInBrowser: () => void,
): Promise<PdfFileResult> {
  return persistNativeFile(fileName, new TextEncoder().encode(contents).buffer, saveInBrowser);
}
