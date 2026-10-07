export type DesktopBridge = {
  engine?: { url?: string; token?: string };
  pickFolder?: (title: string) => Promise<string | null>;
};

export const getBridge = (): DesktopBridge | undefined =>
  (window as unknown as { veDesktop?: DesktopBridge }).veDesktop;
