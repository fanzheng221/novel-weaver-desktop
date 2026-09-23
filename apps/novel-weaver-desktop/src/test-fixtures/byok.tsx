import { createRoot } from "react-dom/client";
import { ByokPage } from "../features/settings/byok/byok-page";
import "../shared/ui/base.css";

const root = document.getElementById("fixture-root");
if (root) createRoot(root).render(<ByokPage cwd="fixture" />);
