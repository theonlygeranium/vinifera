import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./routes/AppRouter";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Vinifera could not find the application root.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
