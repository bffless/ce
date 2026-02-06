import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './store';
import { ThemeProvider } from './components/common/ThemeProvider';
import App from './App';
import './index.css';

// testing workspace-usage
// Read basename from <base> tag to support serving from subdirectories
const getBasename = (): string => {
  const base = document.querySelector('base');
  if (base) {
    const href = base.getAttribute('href');
    if (href && href !== '/') {
      // Remove trailing slash for React Router
      return href.endsWith('/') ? href.slice(0, -1) : href;
    }
  }
  return '';
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter basename={getBasename()}>
        <ThemeProvider defaultTheme="system" storageKey="app-theme">
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </Provider>
  </React.StrictMode>,
);
