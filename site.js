(() => {
  'use strict';
  const menuToggle = document.querySelector('.menu-toggle');
  const mobileNav = document.querySelector('#mobile-nav');
  const setMenu = (open) => {
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    mobileNav.hidden = !open;
  };
  menuToggle.addEventListener('click', () => setMenu(mobileNav.hidden));
  mobileNav.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !mobileNav.hidden) {
      setMenu(false);
      menuToggle.focus();
    }
  });
  window.matchMedia('(min-width: 961px)').addEventListener('change', (event) => {
    if (event.matches) setMenu(false);
  });
  const creditToggle = document.querySelector('.credits-toggle');
  const credits = document.querySelector('#photo-credits');
  creditToggle.addEventListener('click', () => {
    credits.hidden = !credits.hidden;
    creditToggle.setAttribute('aria-expanded', String(!credits.hidden));
  });
})();
