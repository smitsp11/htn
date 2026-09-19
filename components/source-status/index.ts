// The stylesheet is imported here (not from the component file) so the panel
// stays importable under node tests while still being bundled by Next.js.
import "./source-status.css";

export { SourceStatusPanel } from "./source-status";
export type { SourceStatusPanelProps } from "./source-status";
