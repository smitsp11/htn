import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

export interface SiteShellProps {
  children: ReactNode;
}

/**
 * Public-facing site shell ported from federanorth's `federanorth-shell.js`: a sticky
 * header with the wordmark, a skip link for keyboard/screen-reader users, the main
 * content landmark, and a footer repeating the wordmark + tagline.
 */
export function SiteShell({ children }: SiteShellProps) {
  return (
    <>
      <a className="skip-link" href="#queue">
        Skip to submissions
      </a>
      <header className="site-header">
        <a className="brand" href="#main" aria-label="FedAgent home">
          FEDAGENT
          <span className="brand-star">
            <Icon name="north-star" />
          </span>
        </a>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <a href="#main" aria-label="FedAgent home">
          FEDAGENT<span>+</span>
        </a>
        <p>A clearer view of risk.</p>
      </footer>
    </>
  );
}
