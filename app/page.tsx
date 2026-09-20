import { SiteShell } from "@/components/shell/site-shell";
import { Hero } from "@/components/shell/hero";
import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <SiteShell>
      <Hero />
      <div className="workspace">
        <AppShell />
      </div>
    </SiteShell>
  );
}
