import { fetchMe, logout as apiLogout } from '../lib/api.js';

export const createAuthSlice = (set) => ({
      // Auth (not persisted — session lives in the httpOnly cookie, not localStorage)
      currentUser: null,
      authChecked: false,
      checkSession: async () => {
        const user = await fetchMe().catch(() => null);
        set({ currentUser: user, authChecked: true });
      },
      setCurrentUser: (user) => set({ currentUser: user }),
      logout: async () => {
        await apiLogout().catch(() => {});
        set({ currentUser: null });
      },

});
