import { create } from "zustand";

/**
 * 全局状态与 IndexedDB 仓库入口
 */

interface AppState {
  step: "upload" | "review" | "shoot" | "export";
  setStep: (step: AppState["step"]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  step: "upload",
  setStep: (step) => set({ step }),
}));
