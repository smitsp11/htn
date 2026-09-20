export function federanorthShell({ icon }) {
  return `<a class="skip-link" href="#workspace">Skip to submissions</a>
    <header class="site-header">
      <a class="brand" href="#workspace" aria-label="Federanorth workspace">FEDERANORTH<span class="brand-mark">+</span></a>
      <nav class="site-nav" id="sidebar" aria-label="Main navigation"><button class="active" data-nav="queue">Submissions</button></nav>
      <div class="header-tools"><span class="data-status"><i></i> Updated now</span><button id="menu-toggle" class="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded="false" aria-controls="sidebar">${icon('menu')}</button></div>
    </header>
    <main id="main"><div class="workspace" id="workspace"><div class="page-heading"><div><h2>Submissions</h2></div><div class="workspace-actions"><label class="global-search">${icon('search')}<input id="search" type="search" aria-label="Search submissions" placeholder="Search account or submission"><kbd>/</kbd></label><button class="button export-button" id="export-csv">${icon('download')} Export</button></div></div>`;
}
