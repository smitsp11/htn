// The component .tsx imports no CSS so it stays importable under node tests.
// This package index loads the stylesheet (Person 2 cannot edit app/globals.css),
// so import from "@/components/query-trace" in the app to get styles applied.
import "./query-trace.css";

export { QueryTraceView } from "./query-trace";
export type { QueryTraceViewProps } from "./query-trace";
