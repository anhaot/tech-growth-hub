export const loadHomePage = () => import('@/pages/Home');
export const loadQuestionsPage = () => import('@/pages/Questions');
export const loadInterviewCapturePage = () => import('@/pages/InterviewCapture');
export const loadLearningPage = () => import('@/pages/Learning');
export const loadBookmarksPage = () => import('@/pages/Bookmarks');
export const loadSettingsPage = () => import('@/pages/Settings');

const routeLoaders: Record<string, () => Promise<unknown>> = {
  '/': loadHomePage,
  '/questions': loadQuestionsPage,
  '/capture': loadInterviewCapturePage,
  '/study': loadLearningPage,
  '/quiz': loadLearningPage,
  '/bookmarks': loadBookmarksPage,
  '/settings': loadSettingsPage,
};

export const preloadRoute = (path: string) => {
  void routeLoaders[path]?.().catch(() => undefined);
};
