import '@fontsource-variable/mona-sans';
import './style.css';
import { compactStars } from './stars';

const REPO_API = 'https://api.github.com/repos/JeanExtreme002/GitMetrics';

/** Fills every star badge with the live count; the badges simply stay hidden if GitHub is unreachable. */
async function showStars() {
  try {
    const response = await fetch(REPO_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return;
    const { stargazers_count: stars } = (await response.json()) as { stargazers_count?: number };
    if (typeof stars !== 'number') return;
    document.querySelectorAll<HTMLElement>('[data-stars]').forEach((badge) => {
      badge.textContent = compactStars(stars);
      badge.title = `${stars.toLocaleString('en-US')} stars`;
      badge.hidden = false;
    });
  } catch {
    // Offline or rate limited: the buttons work without the number.
  }
}

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

setUpCopy();
void showStars();
