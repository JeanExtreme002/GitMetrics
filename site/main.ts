import '@fontsource-variable/mona-sans';
import './style.css';

/** Copy buttons next to the install command. */
function setUpCopy() {
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const command = button.closest<HTMLElement>('[data-command]')?.dataset.command ?? '';
      try {
        await navigator.clipboard.writeText(command);
        button.textContent = 'Copied';
        button.classList.add('copied');
      } catch {
        button.textContent = 'Press Ctrl + C';
      }
      window.setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('copied');
      }, 1800);
    });
  });
}

/** The small-screen menu: opens from the top bar, closes on a link, Escape or a click outside. */
function setUpMenu() {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  if (!nav || !toggle) return;
  const setOpen = (open: boolean) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav
    .querySelectorAll('.nav-links a')
    .forEach((link) => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
  document.addEventListener('click', (event) => {
    if (!nav.contains(event.target as Node)) setOpen(false);
  });
}

/** Marks the link to the page being viewed. */
function markCurrentPage() {
  const here = window.location.pathname.replace(/index\.html$/, '');
  document.querySelectorAll<HTMLAnchorElement>('.nav-links a[href^="/"]').forEach((link) => {
    if (link.pathname === here && !link.hash) link.setAttribute('aria-current', 'page');
  });
}

/** Tabs: one panel at a time, switched by click or the arrow keys. */
function setUpTabs() {
  document.querySelectorAll<HTMLElement>('[data-tabs]').forEach((tabs) => {
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const select = (chosen: HTMLButtonElement) => {
      for (const button of buttons) {
        const on = button === chosen;
        button.setAttribute('aria-selected', String(on));
        button.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
        if (panel) panel.hidden = !on;
      }
    };
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => select(button));
      button.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        const next = buttons[(index + step + buttons.length) % buttons.length]!;
        select(next);
        next.focus();
      });
    });
  });
}

setUpCopy();
setUpTabs();
setUpMenu();
markCurrentPage();
