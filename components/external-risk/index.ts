// The stylesheet is loaded once via `@import` in app/globals.css so this
// component tree stays importable under node tests.
import "./external-risk.css";
export { ExternalRisk } from "./external-risk";
export type { ExternalRiskProps } from "./external-risk";
