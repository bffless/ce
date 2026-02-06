import { describe, it, expect } from 'vitest';
import repoReducer, {
  setCurrentRepo,
  setCurrentRef,
  setCurrentFilePath,
  selectFile,
  clearRepoState,
  RepoState,
} from './repoSlice';

describe('repoSlice', () => {
  const initialState: RepoState = {
    currentRepo: null,
    currentRef: null,
    currentFilePath: null,
    selectedFile: null,
  };

  describe('setCurrentRepo', () => {
    it('should set current repo with owner and repo name', () => {
      const action = setCurrentRepo({ owner: 'testuser', repo: 'test-repo' });
      const state = repoReducer(initialState, action);

      expect(state.currentRepo).toEqual({
        owner: 'testuser',
        repo: 'test-repo',
      });
    });

    it('should overwrite existing repo', () => {
      const existingState: RepoState = {
        ...initialState,
        currentRepo: { owner: 'olduser', repo: 'old-repo' },
      };

      const action = setCurrentRepo({ owner: 'newuser', repo: 'new-repo' });
      const state = repoReducer(existingState, action);

      expect(state.currentRepo).toEqual({
        owner: 'newuser',
        repo: 'new-repo',
      });
    });
  });

  describe('setCurrentRef', () => {
    it('should set current ref with commit SHA', () => {
      const action = setCurrentRef('abc123def456');
      const state = repoReducer(initialState, action);

      expect(state.currentRef).toBe('abc123def456');
    });

    it('should set current ref with branch name', () => {
      const action = setCurrentRef('main');
      const state = repoReducer(initialState, action);

      expect(state.currentRef).toBe('main');
    });

    it('should overwrite existing ref', () => {
      const existingState: RepoState = {
        ...initialState,
        currentRef: 'old-ref',
      };

      const action = setCurrentRef('new-ref');
      const state = repoReducer(existingState, action);

      expect(state.currentRef).toBe('new-ref');
    });
  });

  describe('setCurrentFilePath', () => {
    it('should set current file path', () => {
      const action = setCurrentFilePath('src/index.html');
      const state = repoReducer(initialState, action);

      expect(state.currentFilePath).toBe('src/index.html');
    });

    it('should handle nested file paths', () => {
      const action = setCurrentFilePath('src/assets/images/logo.png');
      const state = repoReducer(initialState, action);

      expect(state.currentFilePath).toBe('src/assets/images/logo.png');
    });

    it('should set to null when clearing path', () => {
      const existingState: RepoState = {
        ...initialState,
        currentFilePath: 'some/path.html',
      };

      const action = setCurrentFilePath(null);
      const state = repoReducer(existingState, action);

      expect(state.currentFilePath).toBeNull();
    });
  });

  describe('selectFile', () => {
    it('should select file with all metadata', () => {
      const fileData = {
        path: 'index.html',
        name: 'index.html',
        size: 1024,
        mimeType: 'text/html',
      };

      const action = selectFile(fileData);
      const state = repoReducer(initialState, action);

      expect(state.selectedFile).toEqual(fileData);
    });

    it('should select file with minimal metadata', () => {
      const fileData = {
        path: 'README.md',
        name: 'README.md',
      };

      const action = selectFile(fileData);
      const state = repoReducer(initialState, action);

      expect(state.selectedFile).toEqual({
        path: 'README.md',
        name: 'README.md',
        size: undefined,
        mimeType: undefined,
      });
    });

    it('should deselect file when passed null', () => {
      const existingState: RepoState = {
        ...initialState,
        selectedFile: {
          path: 'test.txt',
          name: 'test.txt',
        },
      };

      const action = selectFile(null);
      const state = repoReducer(existingState, action);

      expect(state.selectedFile).toBeNull();
    });

    it('should overwrite existing selected file', () => {
      const existingState: RepoState = {
        ...initialState,
        selectedFile: {
          path: 'old.txt',
          name: 'old.txt',
        },
      };

      const newFile = {
        path: 'new.txt',
        name: 'new.txt',
        size: 2048,
      };

      const action = selectFile(newFile);
      const state = repoReducer(existingState, action);

      expect(state.selectedFile).toEqual(newFile);
    });
  });

  describe('clearRepoState', () => {
    it('should reset all state to initial values', () => {
      const populatedState: RepoState = {
        currentRepo: { owner: 'testuser', repo: 'test-repo' },
        currentRef: 'main',
        currentFilePath: 'index.html',
        selectedFile: {
          path: 'index.html',
          name: 'index.html',
          size: 1024,
          mimeType: 'text/html',
        },
      };

      const action = clearRepoState();
      const state = repoReducer(populatedState, action);

      expect(state).toEqual(initialState);
    });

    it('should handle clearing already empty state', () => {
      const action = clearRepoState();
      const state = repoReducer(initialState, action);

      expect(state).toEqual(initialState);
    });
  });

  describe('state immutability', () => {
    it('should not mutate original state', () => {
      const originalState: RepoState = {
        currentRepo: { owner: 'test', repo: 'repo' },
        currentRef: 'main',
        currentFilePath: 'index.html',
        selectedFile: { path: 'index.html', name: 'index.html' },
      };

      // Create a deep copy to compare later
      const stateCopy = JSON.parse(JSON.stringify(originalState));

      // Perform action
      repoReducer(originalState, setCurrentRef('new-ref'));

      // Original state should be unchanged
      expect(originalState).toEqual(stateCopy);
    });
  });

  describe('action chaining', () => {
    it('should handle multiple actions in sequence', () => {
      let state = initialState;

      state = repoReducer(state, setCurrentRepo({ owner: 'user', repo: 'repo' }));
      expect(state.currentRepo).toEqual({ owner: 'user', repo: 'repo' });

      state = repoReducer(state, setCurrentRef('main'));
      expect(state.currentRef).toBe('main');
      expect(state.currentRepo).toEqual({ owner: 'user', repo: 'repo' });

      state = repoReducer(state, setCurrentFilePath('index.html'));
      expect(state.currentFilePath).toBe('index.html');
      expect(state.currentRef).toBe('main');
      expect(state.currentRepo).toEqual({ owner: 'user', repo: 'repo' });

      state = repoReducer(
        state,
        selectFile({ path: 'index.html', name: 'index.html', size: 1024 }),
      );
      expect(state.selectedFile).toEqual({
        path: 'index.html',
        name: 'index.html',
        size: 1024,
      });
      expect(state.currentFilePath).toBe('index.html');
    });
  });
});
