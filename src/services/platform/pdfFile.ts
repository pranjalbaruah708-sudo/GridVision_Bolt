import { Directory, Filesystem } from '@capacitor/filesystem';
import { isNativeApp } from './runtime';

export type PdfFileResult = { fileName: string; nativePath?: string };

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function persistPdfFile(
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
  return { fileName, nativePath: result.uri };
}
