import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import './styles.css';

// Route /admin → Admin console; everything else → consumer chat
const isAdminPath = window.location.pathname.startsWith('/admin');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isAdminPath ? <Admin /> : <App />}
  </React.StrictMode>
);
