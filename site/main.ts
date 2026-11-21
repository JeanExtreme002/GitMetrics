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

setUpCopy();
