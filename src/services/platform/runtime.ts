import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export type GridVisionPlatform = 'android' | 'ios' | 'web' | string;

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
export const isWebApp = (): boolean => !isNativeApp();
export const isAndroidApp = (): boolean => Capacitor.getPlatform() === 'android';
export const getAppPlatform = (): GridVisionPlatform => Capacitor.getPlatform();

export function getPlatformName(): string {
  const platform = getAppPlatform();
  return ({ android: 'Android', ios: 'iOS', web: 'Web' } as Record<string, string>)[platform] ?? platform;
}

export function getRuntimeMode(): string {
  if (isNativeApp()) return 'Native app';
  return window.matchMedia('(display-mode: standalone)').matches ? 'PWA · Standalone' : 'Web browser';
}

export async function minimizeAndroidApp(): Promise<void> {
  if (isAndroidApp()) await CapacitorApp.minimizeApp();
}

export async function addAndroidBackButtonListener(onBack: () => void): Promise<{ remove: () => Promise<void> } | null> {
  if (!isAndroidApp()) return null;
  return CapacitorApp.addListener('backButton', onBack);
}
