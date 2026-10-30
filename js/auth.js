/**
 * The account screen: sign in, create an account, request a reset link, and —
 * when a recovery link brings you back — choose a new password.
 */
import { $, $$, show } from './dom.js';
import { IS_CONFIGURED, MIN_PASSWORD_LENGTH } from './config.js';
import {
  describeAuthError,
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from './supabase-rest.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const COPY = {
  signin: {
    title: 'Welcome back',
    sub: 'Sign in to see this month honestly.',
    submit: 'Sign in',
    busy: 'Signing in…',
  },
  signup: {
    title: 'Create your account',
    sub: 'One account, one month at a time. Your entries stay yours.',
    submit: 'Create account',
    busy: 'Creating account…',
  },
  recover: {
    title: 'Reset your password',
    sub: 'We’ll email you a link to set a new one.',
    submit: 'Send reset link',
    busy: 'Sending…',
  },
  update: {
    title: 'Choose a new password',
    sub: 'The link worked. Pick a password you haven’t used here before.',
    submit: 'Save new password',
    busy: 'Saving…',
  },
};

export function mountAuth({ onSignedIn, initialMessage = '', initialMode = 'signin' } = {}) {
  const form = $('#authForm');
  const tabs = $('#authTabs');
  const emailField = $('#authEmailField');
  const emailInput = $('#authEmail');
  const passwordField = $('#authPasswordField');
  const passwordInput = $('#authPassword');
  const confirmField = $('#authConfirmField');
  const confirmInput = $('#authPasswordConfirm');
  const errorSlot = $('#authError');
  const statusSlot = $('#authStatus');
  const submitButton = $('#authSubmit');
  const title = $('#authTitle');
  const subtitle = $('#authSub');
  const tabButtons = $$('.tabs [data-mode]');
  const forgotButton = $('#authForgot');
  const backButton = $('#authBack');

  let mode = 'signin';

  function setError(message = '') {
    errorSlot.textContent = message;
    for (const input of [emailInput, passwordInput, confirmInput]) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function setStatus(message = '') {
    statusSlot.textContent = message;
  }

  function setBusy(busy) {
    submitButton.disabled = busy;
    submitButton.textContent = busy ? COPY[mode].busy : COPY[mode].submit;
  }

  function setMode(next) {
    mode = next;
    const copy = COPY[mode];
    const isPortal = mode === 'signin' || mode === 'signup';

    show(tabs, isPortal);
    show(emailField, mode !== 'update');
    show(passwordField, mode !== 'recover');
    show(confirmField, mode === 'update');
    show(forgotButton, mode === 'signin');
    show(backButton, mode === 'recover' || mode === 'update');

    for (const tab of tabButtons) {
      tab.setAttribute('aria-pressed', String(tab.dataset.mode === mode));
    }

    title.textContent = copy.title;
    subtitle.textContent = copy.sub;
    submitButton.textContent = copy.submit;
    passwordInput.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';

    setError('');
    setStatus('');
  }

  function firstField() {
    return mode === 'update' ? passwordInput : emailInput;
  }

  for (const tab of tabButtons) {
    tab.addEventListener('click', () => {
      if (tab.dataset.mode === mode) return;
      setMode(tab.dataset.mode);
      firstField().focus();
    });
  }

  forgotButton.addEventListener('click', () => {
    setMode('recover');
    emailInput.focus();
  });

  backButton.addEventListener('click', () => {
    if (mode === 'update') {
      // The recovery link already signed us in; a reload lands on the dashboard.
      location.replace(location.pathname);
      return;
    }
    setMode('signin');
    emailInput.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');

    if (!IS_CONFIGURED) {
      setError('Finora isn’t connected to Supabase yet. Add your project URL and publishable key in js/config.js.');
      return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (mode !== 'update' && !EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address.');
      emailInput.focus();
      return;
    }

    if (mode !== 'recover') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        passwordInput.focus();
        return;
      }

      if (mode === 'update' && password !== confirmInput.value) {
        setError('Those two passwords don’t match.');
        confirmInput.focus();
        return;
      }
    }

    setError('');
    setBusy(true);

    try {
      if (mode === 'recover') {
        await requestPasswordReset(email);
        setStatus(`If ${email} has an account, a reset link is on its way. Check your spam folder too.`);
        return;
      }

      if (mode === 'update') {
        await updatePassword(password);
        form.reset();
        setStatus('Password updated. Opening your ledger…');
        onSignedIn?.();
        return;
      }

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
      if (mode === 'update' || mode === 'signup') passwordInput.select();
      else if (mode === 'recover') emailInput.select();
      else passwordInput.select();
    } finally {
      setBusy(false);
    }
  });

  setMode(initialMode);
  if (initialMessage) setStatus(initialMessage);
  if (!IS_CONFIGURED) {
    setStatus('Finora isn’t connected to Supabase yet. Add your project URL and publishable key to js/config.js.');
  }

  return { focusEmail: () => firstField().focus() };
}
