/** The sign-in / create-account screen. */
import { $, $$ } from './dom.js';
import { IS_CONFIGURED, MIN_PASSWORD_LENGTH } from './config.js';
import { describeAuthError, signIn, signUp } from './supabase-rest.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function mountAuth({ onSignedIn, initialMessage = '' } = {}) {
  const form = $('#authForm');
  const emailInput = $('#authEmail');
  const passwordInput = $('#authPassword');
  const errorSlot = $('#authError');
  const statusSlot = $('#authStatus');
  const submitButton = $('#authSubmit');
  const title = $('#authTitle');
  const subtitle = $('#authSub');
  const tabs = $$('.tabs [role="tab"]');

  let mode = 'signin';

  function setError(message = '') {
    errorSlot.textContent = message;
    for (const input of [emailInput, passwordInput]) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function setStatus(message = '') {
    statusSlot.textContent = message;
  }

  function setBusy(busy) {
    submitButton.disabled = busy;
    submitButton.textContent = busy
      ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
      : (mode === 'signin' ? 'Sign in' : 'Create account');
  }

  function setMode(next) {
    mode = next;
    for (const tab of tabs) {
      const active = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    title.textContent = mode === 'signin' ? 'Welcome back' : 'Create your account';
    subtitle.textContent = mode === 'signin'
      ? 'Sign in to see this month honestly.'
      : 'One account, one month at a time. Your entries stay yours.';
    submitButton.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    passwordInput.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    setError('');
    setStatus('');
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      if (tab.dataset.mode === mode) return;
      setMode(tab.dataset.mode);
      emailInput.focus();
    });
  }

  // Left/right arrows move between the two tabs, as tablists should.
  for (const tab of tabs) {
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = tab.dataset.mode === 'signin' ? 'signup' : 'signin';
      setMode(next);
      $(`#tab${next === 'signin' ? 'Signin' : 'Signup'}`).focus();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');

    if (!IS_CONFIGURED) {
      setError('Finora isn’t connected to Supabase yet. Add your project URL and publishable key in js/config.js.');
      return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address.');
      emailInput.focus();
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      passwordInput.focus();
      return;
    }

    setError('');
    setBusy(true);

    try {
      if (mode === 'signin') {
        await signIn(email, password);
        form.reset();
        onSignedIn();
        return;
      }

      const result = await signUp(email, password);

      if (result.needsConfirmation) {
        setMode('signin');
        emailInput.value = email;
        setStatus(`Almost there. We sent a confirmation link to ${email}. Open it, then sign in here.`);
        passwordInput.focus();
        return;
      }

      form.reset();
      onSignedIn();
    } catch (error) {
      setError(describeAuthError(error));
      passwordInput.select();
    } finally {
      setBusy(false);
    }
  });

  setMode('signin');
  if (initialMessage) setStatus(initialMessage);
  if (!IS_CONFIGURED) {
    setStatus('Supabase isn’t configured yet — the demo still works.');
  }

  return { focusEmail: () => emailInput.focus() };
}
