export interface Target {
  tabId: number;
  origin: string;
  url: string;
  frameId: 0; // V1: top-level frame only
}