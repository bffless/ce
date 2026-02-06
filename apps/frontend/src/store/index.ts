import { configureStore } from '@reduxjs/toolkit';
import { api } from '@/services/api';
import repoReducer from './slices/repoSlice';
import uiReducer from './slices/uiSlice';
import repoOverviewReducer from './slices/repoOverviewSlice';
import authReducer from './slices/authSlice';
import repositoryListReducer from './slices/repositoryListSlice';
import domainsReducer from './slices/domainsSlice';
import setupReducer from './slices/setupSlice';
import refSelectorReducer from './slices/refSelectorSlice';
import iframeNavigationReducer from './slices/iframeNavigationSlice';

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    repo: repoReducer,
    ui: uiReducer,
    repoOverview: repoOverviewReducer,
    auth: authReducer,
    repositoryList: repositoryListReducer,
    domains: domainsReducer,
    setup: setupReducer,
    refSelector: refSelectorReducer,
    iframeNavigation: iframeNavigationReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(api.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

