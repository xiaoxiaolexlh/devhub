import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LauncherWindow } from "./components/LauncherWindow";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("launcher") ? <LauncherWindow /> : <App />}
  </React.StrictMode>,
);
