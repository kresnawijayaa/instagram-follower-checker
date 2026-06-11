import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import SimplePage from "./SimplePage";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SimplePage />
    <Analytics />
  </React.StrictMode>
);
