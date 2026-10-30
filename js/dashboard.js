/**
 * The dashboard owns one month of state.
 *
 * It reads and writes through a small store interface (loadMonth,
 * create/update/delete transaction, set/clear budget) and never builds a query
 * itself — RLS decides which rows exist, this file only decides how they look.
 */
import { MAX_NOTE_LENGTH } from './config.js';
import { allCategories, categoriesFor, isKnownCategory, typeLabel } from './categories.js';
import { destroyDonut, paletteFor, renderDonut } from './chart.js';
import { $, $$, clear, el, setText, show } from './dom.js';
import {
  currentMonthKey,
  daysInMonth,
  elapsedDays,
  formatEntryDate,
  formatFullDate,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  isValidISODate,
  monthLabel,
  monthStart,
  parseAmount,
  pluralize,
  round2,
  shiftMonthKey,
  todayISO,
} from './format.js';
import { humanError } from './supabase-rest.js';
import { toast } from './toast.js';

const state = {
  month: currentMonthKey(),
  transactions: [],
  budget: null,
  loading: false,
  error: null,
  filters: { type: 'all', category: 'all', query: '' },
  editing: null,
  busy: false,
};

let refs = {};
let loadToken = 0;

export function mountDashboard({ store, user, onSignOut }) {
  refs = {
    monthLabel: $('#monthLabel'),
    monthNote: $('#monthNote'),
    prevMonth: $('#prevMonthBtn'),
    nextMonth: $('#nextMonthBtn'),
    thisMonth: $('#thisMonthBtn'),

    incomeValue: $('#incomeValue'),
    incomeNote: $('#incomeNote'),
    expenseValue: $('#expenseValue'),
    expenseNote: $('#expenseNote'),
    balanceValue: $('#balanceValue'),
    balanceNote: $('#balanceNote'),

    budgetBody: $('#budgetBody'),
    budgetEmpty: $('#budgetEmpty'),
    budgetSpent: $('#budgetSpent'),
    budgetLeft: $('#budgetLeft'),
    budgetFill: $('#budgetFill'),
    budgetMeter: $('#budgetMeter'),
    budgetNote: $('#budgetNote'),
    editBudget: $('#editBudgetBtn'),
    budgetEmptyBtn: $('#budgetEmptyBtn'),

    entriesCount: $('#entriesCount'),
    typeTabs: $('#typeTabs'),
    categoryFilter: $('#categoryFilter'),
    searchInput: $('#searchInput'),
    entriesBody: $('#entriesBody'),
    tableWrap: $('#entriesTableWrap'),
    entriesEmpty: $('#entriesEmpty'),
    entriesNoMatch: $('#entriesNoMatch'),
    entriesNoMatchText: $('#entriesNoMatchText'),
    clearFilters: $('#clearFiltersBtn'),
    entriesSummary: $('#entriesSummary'),
    entriesHeading: $('#entriesHeading'),
    entriesEmptyAdd: $('#entriesEmptyAddBtn'),

    loadError: $('#loadError'),
    loadErrorText: $('#loadErrorText'),
    retryLoad: $('#retryLoadBtn'),

    donut: $('#donut'),
    donutWrap: $('#donutWrap'),
    donutTotal: $('#donutTotal'),
    legend: $('#legend'),
    breakdownEmpty: $('#breakdownEmpty'),

    insightBiggest: $('#insightBiggest'),
    insightAverage: $('#insightAverage'),
    insightDays: $('#insightDays'),

    accountEmail: $('#accountEmail'),
    avatarInitial: $('#avatarInitial'),
    accountBtn: $('#accountBtn'),
    accountMenu: $('#accountMenu'),
    signOutBtn: $('#signOutBtn'),
    addEntry: $('#addEntryBtn'),
    storageNote: $('#storageNote'),

    entryDialog: $('#entryDialog'),
    entryForm: $('#entryForm'),
    entryTitle: $('#entryTitle'),
    entryAmount: $('#entryAmount'),
    entryCategory: $('#entryCategory'),
    entryDate: $('#entryDate'),
    entryNote: $('#entryNote'),
    typePicker: $('#typePicker'),
    amountError: $('#amountError'),
    dateError: $('#dateError'),
    noteError: $('#noteError'),
    entryError: $('#entryError'),
    saveEntry: $('#saveEntryBtn'),
    deleteEntry: $('#deleteEntryBtn'),

    budgetDialog: $('#budgetDialog'),
    budgetForm: $('#budgetForm'),
    budgetMonthLabel: $('#budgetMonthLabel'),
    budgetInput: $('#budgetAmountInput'),
    budgetAmountError: $('#budgetAmountError'),
    budgetError: $('#budgetError'),
    saveBudget: $('#saveBudgetBtn'),
    removeBudget: $('#removeBudgetBtn'),

    confirmDialog: $('#confirmDialog'),
    confirmTitle: $('#confirmTitle'),
    confirmMessage: $('#confirmMessage'),
    confirmOk: $('#confirmOk'),
    confirmCancel: $('#confirmCancel'),
  };

  /* ---------------------------------------------------------------- */
  /* data                                                              */
  /* ---------------------------------------------------------------- */

  function summarize(transactions) {
    let income = 0;
    let expense = 0;
    for (const entry of transactions) {
      if (entry.type === 'income') income += entry.amount;
      else expense += entry.amount;
    }
    return {
      income: round2(income),
      expense: round2(expense),
      balance: round2(income - expense),
    };
  }

  function expenseSeries(transactions) {
    const totals = new Map();
    for (const entry of transactions) {
      if (entry.type !== 'expense') continue;
      totals.set(entry.category, round2((totals.get(entry.category) ?? 0) + entry.amount));
    }
    return [...totals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  function visibleEntries() {
    const { type, category, query } = state.filters;
    const needle = query.trim().toLowerCase();

    return state.transactions
      .filter((entry) => type === 'all' || entry.type === type)
      .filter((entry) => category === 'all' || entry.category === category)
      .filter((entry) => {
        if (!needle) return true;
        return entry.note.toLowerCase().includes(needle)
          || entry.category.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? 1 : -1;
        return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
      });
  }

  async function load() {
    const token = ++loadToken;
    const monthKey = state.month;

    state.loading = true;
    show(refs.loadError, false);
    renderMonthChrome();

    try {
      const data = await store.loadMonth(monthKey);
      if (token !== loadToken) return; // a newer month took over while this was in flight
      state.transactions = data.transactions ?? [];
      state.budget = typeof data.budget === 'number' ? data.budget : null;
      state.error = null;
    } catch (error) {
      if (token !== loadToken) return;
      state.error = error;
      state.transactions = [];
      state.budget = null;
      setText(refs.loadErrorText, humanError(error, 'Could not load this month.'));
      show(refs.loadError, true);
    } finally {
      if (token === loadToken) {
        state.loading = false;
        render();
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* rendering                                                         */
  /* ---------------------------------------------------------------- */

  function render() {
    renderMonthChrome();
    renderCategoryFilter();
    const totals = summarize(state.transactions);
    renderSummary(totals);
    renderBudget(totals);
    renderEntries();
    renderBreakdown();
    renderInsights(totals);
    setText(refs.storageNote, 'Stored in Supabase · visible only to you');
  }

  function renderMonthChrome() {
    const previous = shiftMonthKey(state.month, -1);
    const next = shiftMonthKey(state.month, 1);

    setText(refs.monthLabel, monthLabel(state.month));
    refs.prevMonth.setAttribute('aria-label', `Previous month: ${monthLabel(previous)}`);
    refs.nextMonth.setAttribute('aria-label', `Next month: ${monthLabel(next)}`);
    refs.thisMonth.disabled = state.month === currentMonthKey();

    const days = elapsedDays(state.month);
    const spent = summarize(state.transactions).expense;
    setText(refs.monthNote, days > 0 && spent > 0
      ? `${formatMoney(round2(spent / days))} avg / day`
      : '');
  }

  function renderSummary(totals) {
    setText(refs.incomeValue, formatMoney(totals.income));
    setText(refs.expenseValue, formatMoney(totals.expense));
    setText(refs.balanceValue, formatMoney(totals.balance));
    refs.balanceValue.classList.toggle('is-negative', totals.balance < 0);

    const incomeCount = state.transactions.filter((entry) => entry.type === 'income').length;
    const expenseCount = state.transactions.filter((entry) => entry.type === 'expense').length;

    setText(refs.incomeNote, `${incomeCount} ${pluralize(incomeCount, 'entry', 'entries')}`);
    setText(refs.expenseNote, `${expenseCount} ${pluralize(expenseCount, 'entry', 'entries')}`);
    setText(refs.balanceNote, totals.balance >= 0 ? 'Left after expenses' : 'More out than in');
  }

  function renderBudget(totals) {
    const hasBudget = typeof state.budget === 'number' && state.budget > 0;

    show(refs.budgetBody, hasBudget);
    show(refs.budgetEmpty, !hasBudget);
    setText(refs.editBudget, hasBudget ? 'Edit' : 'Set budget');

    if (!hasBudget) return;

    const spent = totals.expense;
    const ratio = spent / state.budget;
    const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));

    setText(refs.budgetSpent, formatMoney(spent));
    setText(refs.budgetLeft, `of ${formatMoney(state.budget)}`);

    refs.budgetFill.style.width = `${percent}%`;
    refs.budgetFill.classList.toggle('is-near', ratio >= 0.8 && ratio <= 1);
    refs.budgetFill.classList.toggle('is-over', ratio > 1);

    refs.budgetMeter.setAttribute('aria-valuenow', String(percent));
    refs.budgetMeter.setAttribute('aria-valuetext', `${percent}% of the ${formatMoney(state.budget)} budget used`);

    const remaining = round2(state.budget - spent);
    if (remaining < 0) {
      setText(refs.budgetNote, `${formatMoney(Math.abs(remaining))} over · ${formatPercent(spent, state.budget)} of budget used`);
    } else if (remaining === 0) {
      setText(refs.budgetNote, 'Exactly on budget — nothing left, nothing over.');
    } else {
      setText(refs.budgetNote, `${formatMoney(remaining)} left · ${formatPercent(spent, state.budget)} used`);
    }
  }

  function renderCategoryFilter() {
    const select = refs.categoryFilter;
    const previous = state.filters.category;
    const present = [...new Set(state.transactions.map((entry) => entry.category))].sort();
    const options = ['all', ...new Set([...present, ...allCategories()])];

    clear(select);
    for (const category of options) {
      select.append(el('option', {
        value: category,
        text: category === 'all' ? 'All categories' : category,
      }));
    }

    const valid = options.includes(previous) ? previous : 'all';
    state.filters.category = valid;
    select.value = valid;
  }

  function buildRow(entry) {
    const isIncome = entry.type === 'income';
    const title = entry.note || entry.category;

    const dateCell = el('td', { class: 'date-cell', role: 'cell' }, [
      el('time', {
        datetime: entry.occurred_on,
        title: formatFullDate(entry.occurred_on),
        text: formatEntryDate(entry.occurred_on),
      }),
    ]);

    const entryCell = el('td', { class: 'entry-main', role: 'cell' }, [
      el('span', { class: 'entry-title', text: title }),
      el('span', { class: 'entry-sub', text: typeLabel(entry.type) }),
    ]);

    const categoryCell = el('td', { class: 'chip-cell', role: 'cell' }, [
      el('span', { class: 'chip', text: entry.category }),
    ]);

    const amountCell = el('td', {
      class: `num ${isIncome ? 'amount-income' : 'amount-expense'}`,
      role: 'cell',
      text: formatSignedMoney(entry.amount, entry.type),
    });

    const actionsCell = el('td', { class: 'actions-cell', role: 'cell' }, [
      el('div', { class: 'row-actions' }, [
        el('button', {
          type: 'button',
          class: 'row-btn',
          title: 'Edit entry',
          'aria-label': `Edit ${title}`,
          onclick: () => openEntryDialog(entry),
        }, ['✎']),
        el('button', {
          type: 'button',
          class: 'row-btn danger',
          title: 'Delete entry',
          'aria-label': `Delete ${title}`,
          onclick: () => removeEntry(entry),
        }, ['✕']),
      ]),
    ]);

    return el('tr', { role: 'row' }, [dateCell, entryCell, categoryCell, amountCell, actionsCell]);
  }

  function renderEntries() {
    const rows = visibleEntries();
    const hasAny = state.transactions.length > 0;
    const hasRows = rows.length > 0;

    clear(refs.entriesBody);
    show(refs.tableWrap, hasRows);
    show(refs.entriesEmpty, !hasAny && !state.error);
    show(refs.entriesNoMatch, hasAny && !hasRows);

    setText(refs.entriesCount, String(rows.length));

    if (!hasRows) {
      setText(refs.entriesSummary, '');
      if (hasAny) {
        const active = [];
        if (state.filters.type !== 'all') active.push(state.filters.type === 'income' ? 'income' : 'expenses');
        if (state.filters.category !== 'all') active.push(state.filters.category);
        if (state.filters.query.trim()) active.push(`“${state.filters.query.trim()}”`);
        setText(refs.entriesNoMatchText, active.length
          ? `Nothing matches ${active.join(' + ')} in ${monthLabel(state.month, { short: true })}.`
          : `Nothing matches in ${monthLabel(state.month, { short: true })}.`);
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of rows) fragment.append(buildRow(entry));
    refs.entriesBody.append(fragment);

    const out = round2(rows.filter((entry) => entry.type === 'expense')
      .reduce((sum, entry) => sum + entry.amount, 0));
    const income = round2(rows.filter((entry) => entry.type === 'income')
      .reduce((sum, entry) => sum + entry.amount, 0));

    const parts = [];
    if (out > 0) parts.push(`${formatMoney(out)} out`);
    if (income > 0) parts.push(`${formatMoney(income)} in`);

    setText(refs.entriesSummary, [
      `${rows.length} ${pluralize(rows.length, 'entry', 'entries')} shown`,
      ...parts,
    ].join(' · '));
  }

  function renderBreakdown() {
    const series = expenseSeries(state.transactions);
    const total = round2(series.reduce((sum, point) => sum + point.value, 0));
    const colors = paletteFor();

    clear(refs.legend);
    show(refs.donutWrap, series.length > 0);
    show(refs.breakdownEmpty, series.length === 0);
    setText(refs.donutTotal, formatMoney(total, { decimals: false }));

    if (!series.length) {
      destroyDonut();
      return;
    }

    for (const [index, point] of series.entries()) {
      const color = colors[index % colors.length];
      refs.legend.append(el('li', {}, [
        el('span', { class: 'swatch', style: `background:${color}` }),
        el('span', { class: 'legend-name', text: point.label }),
        el('span', { class: 'legend-value', text: formatMoney(point.value) }),
        el('span', { class: 'legend-pct', text: formatPercent(point.value, total) }),
      ]));
    }

    renderDonut(refs.donut, series);
  }

  function renderInsights(totals) {
    const expenses = state.transactions.filter((entry) => entry.type === 'expense');
    const biggest = expenses.reduce((max, entry) => (!max || entry.amount > max.amount ? entry : max), null);
    const days = elapsedDays(state.month);

    setText(refs.insightBiggest, biggest
      ? `${formatMoney(biggest.amount)} · ${biggest.note || biggest.category}`
      : '—');

    setText(refs.insightAverage, days > 0
      ? `${formatMoney(round2(totals.expense / days))} / day`
      : '—');

    const logged = new Set(expenses.map((entry) => entry.occurred_on)).size;
    setText(refs.insightDays, days > 0 ? `${logged} of ${days}` : String(logged));
  }

  /* ---------------------------------------------------------------- */
  /* errors and busy buttons                                           */
  /* ---------------------------------------------------------------- */

  function setError(node, message = '') {
    if (!node) return;
    node.textContent = message;
    const input = node.closest('.field')?.querySelector('input, select');
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function clearFormErrors() {
    setError(refs.amountError);
    setError(refs.dateError);
    setError(refs.noteError);
    setError(refs.entryError);
  }

  function setBusy(button, busy, busyLabel, idleLabel) {
    button.disabled = busy;
    button.textContent = busy ? busyLabel : idleLabel;
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  /* ---------------------------------------------------------------- */
  /* entry dialog                                                      */
  /* ---------------------------------------------------------------- */

  function defaultDateForMonth() {
    const current = currentMonthKey();
    if (state.month === current) return todayISO();
    if (state.month < current) {
      return `${state.month}-${String(daysInMonth(state.month)).padStart(2, '0')}`;
    }
    return monthStart(state.month);
  }

  function setEntryType(type) {
    for (const radio of $$('input[name="type"]', refs.typePicker)) {
      radio.checked = radio.value === type;
    }

    const previous = refs.entryCategory.value;
    const categories = categoriesFor(type);
    clear(refs.entryCategory);
    for (const category of categories) {
      refs.entryCategory.append(el('option', { value: category, text: category }));
    }
    refs.entryCategory.value = categories.includes(previous) ? previous : categories[0];
  }

  function openEntryDialog(entry = null) {
    state.editing = entry;
    clearFormErrors();

    setText(refs.entryTitle, entry ? 'Edit entry' : 'Add entry');
    setText(refs.saveEntry, entry ? 'Save changes' : 'Save entry');
    show(refs.deleteEntry, Boolean(entry));

    setEntryType(entry?.type ?? 'expense');
    refs.entryAmount.value = entry ? entry.amount.toFixed(2) : '';
    if (entry && isKnownCategory(entry.type, entry.category)) {
      refs.entryCategory.value = entry.category;
    }
    refs.entryDate.value = entry?.occurred_on ?? defaultDateForMonth();
    refs.entryNote.value = entry?.note ?? '';

    refs.entryDialog.showModal();
    requestAnimationFrame(() => refs.entryAmount.focus());
  }

  async function handleEntrySubmit(event) {
    event.preventDefault();
    if (state.busy) return;

    clearFormErrors();

    const type = $$('input[name="type"]', refs.typePicker).find((radio) => radio.checked)?.value ?? 'expense';
    const amount = parseAmount(refs.entryAmount.value);
    const date = refs.entryDate.value;
    const note = refs.entryNote.value.trim();
    const category = refs.entryCategory.value;

    let firstInvalid = null;

    if (amount === null) {
      setError(refs.amountError, 'Enter an amount above zero, like 145.50.');
      firstInvalid = firstInvalid ?? refs.entryAmount;
    }

    if (!isValidISODate(date)) {
      setError(refs.dateError, 'Choose a real date.');
      firstInvalid = firstInvalid ?? refs.entryDate;
    }

    if (!isKnownCategory(type, category)) {
      setError(refs.entryError, 'Choose a category for this entry.');
      firstInvalid = firstInvalid ?? refs.entryCategory;
    }

    if (note.length > MAX_NOTE_LENGTH) {
      setError(refs.noteError, `Keep the note under ${MAX_NOTE_LENGTH} characters.`);
      firstInvalid = firstInvalid ?? refs.entryNote;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const payload = { type, amount, category, occurred_on: date, note };
    const editing = state.editing;
    const idleLabel = editing ? 'Save changes' : 'Save entry';

    state.busy = true;
    setBusy(refs.saveEntry, true, editing ? 'Saving…' : 'Adding…', idleLabel);

    try {
      if (editing) {
        await store.updateTransaction(editing.id, payload);
        toast('Entry updated.');
      } else {
        await store.createTransaction(payload);
        toast('Entry added.');
      }
      closeDialog(refs.entryDialog);
      state.editing = null;
      await load();
    } catch (error) {
      setError(refs.entryError, humanError(error, 'Could not save that entry.'));
    } finally {
      state.busy = false;
      setBusy(refs.saveEntry, false, '', idleLabel);
    }
  }

  async function handleDialogDelete() {
    const entry = state.editing;
    if (!entry) return;

    // Keep the entry dialog open, so cancelling leaves the person where they were.
    const confirmed = await askConfirm({
      title: 'Delete this entry?',
      message: `${formatMoney(entry.amount)} · ${entry.note || entry.category} on ${formatFullDate(entry.occurred_on)}. This cannot be undone.`,
      confirmLabel: 'Delete entry',
    });
    if (!confirmed) return;

    closeDialog(refs.entryDialog);
    state.editing = null;
    await deleteEntry(entry);
  }

  /* ---------------------------------------------------------------- */
  /* budget dialog                                                     */
  /* ---------------------------------------------------------------- */

  function openBudgetDialog() {
    setError(refs.budgetAmountError);
    setError(refs.budgetError);

    setText(refs.budgetMonthLabel, `Budget for ${monthLabel(state.month)}.`);
    refs.budgetInput.value = state.budget != null ? state.budget.toFixed(2) : '';
    show(refs.removeBudget, state.budget != null);

    refs.budgetDialog.showModal();
    requestAnimationFrame(() => refs.budgetInput.focus());
  }

  async function handleBudgetSubmit(event) {
    event.preventDefault();
    if (state.busy) return;

    setError(refs.budgetAmountError);
    setError(refs.budgetError);

    const amount = parseAmount(refs.budgetInput.value);
    if (amount === null) {
      setError(refs.budgetAmountError, 'Enter a budget above zero, like 10000.');
      refs.budgetInput.focus();
      return;
    }

    state.busy = true;
    setBusy(refs.saveBudget, true, 'Saving…', 'Save budget');

    try {
      await store.setBudget(state.month, amount);
      closeDialog(refs.budgetDialog);
      await load();
      toast(`Budget set for ${monthLabel(state.month, { short: true })}.`);
    } catch (error) {
      setError(refs.budgetError, humanError(error, 'Could not save the budget.'));
    } finally {
      state.busy = false;
      setBusy(refs.saveBudget, false, '', 'Save budget');
    }
  }

  async function handleBudgetRemove() {
    closeDialog(refs.budgetDialog);
    try {
      await store.clearBudget(state.month);
      await load();
      toast('Budget removed.');
    } catch (error) {
      toast(humanError(error, 'Could not remove the budget.'));
    }
  }

  /* ---------------------------------------------------------------- */
  /* confirm + delete                                                  */
  /* ---------------------------------------------------------------- */

  function askConfirm({ title, message, confirmLabel = 'Delete' }) {
    setText(refs.confirmTitle, title);
    setText(refs.confirmMessage, message);
    setText(refs.confirmOk, confirmLabel);

    return new Promise((resolve) => {
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        refs.confirmOk.removeEventListener('click', onOk);
        refs.confirmCancel.removeEventListener('click', onCancel);
        refs.confirmDialog.removeEventListener('close', onClose);
        refs.confirmDialog.removeEventListener('cancel', onCancelKey);
        if (refs.confirmDialog.open) refs.confirmDialog.close();
        resolve(value);
      };

      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onClose = () => finish(false);
      const onCancelKey = (event) => {
        event.preventDefault();
        finish(false);
      };

      refs.confirmOk.addEventListener('click', onOk);
      refs.confirmCancel.addEventListener('click', onCancel);
      refs.confirmDialog.addEventListener('close', onClose);
      refs.confirmDialog.addEventListener('cancel', onCancelKey);

      refs.confirmDialog.showModal();
      refs.confirmCancel.focus();
    });
  }

  async function removeEntry(entry) {
    const confirmed = await askConfirm({
      title: 'Delete this entry?',
      message: `${formatMoney(entry.amount)} · ${entry.note || entry.category} on ${formatFullDate(entry.occurred_on)}. This cannot be undone.`,
      confirmLabel: 'Delete entry',
    });
    if (!confirmed) return;
    await deleteEntry(entry);
  }

  async function deleteEntry(entry) {
    try {
      await store.deleteTransaction(entry.id);
      await load();
      toast('Entry deleted.');
      refs.entriesHeading.focus(); // the row that had focus is gone
    } catch (error) {
      toast(humanError(error, 'Could not delete that entry.'));
    }
  }

  /* ---------------------------------------------------------------- */
  /* account menu, filters                                             */
  /* ---------------------------------------------------------------- */

  function setupAccount() {
    const menu = refs.accountMenu;
    const button = refs.accountBtn;

    const closeMenu = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = menu.hidden;
      menu.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (opening) menu.querySelector('button:not([hidden])')?.focus();
    });

    document.addEventListener('click', (event) => {
      if (menu.hidden) return;
      if (menu.contains(event.target) || button.contains(event.target)) return;
      closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || menu.hidden) return;
      closeMenu();
      button.focus();
    });

    for (const item of $$('button', menu)) item.addEventListener('click', closeMenu);

    const email = user?.email || 'Signed in';
    setText(refs.accountEmail, email);
    setText(refs.avatarInitial, (email[0] || 'F').toUpperCase());
    refs.accountEmail.title = email;
    setText(refs.signOutBtn, 'Sign out');

    refs.signOutBtn.addEventListener('click', () => onSignOut?.());
  }

  function goToMonth(monthKey) {
    if (!monthKey || monthKey === state.month) return;
    state.month = monthKey;
    load();
  }

  function setupMonthNavigation() {
    refs.prevMonth.addEventListener('click', () => goToMonth(shiftMonthKey(state.month, -1)));
    refs.nextMonth.addEventListener('click', () => goToMonth(shiftMonthKey(state.month, 1)));
    refs.thisMonth.addEventListener('click', () => goToMonth(currentMonthKey()));
  }

  function setupFilters() {
    refs.typeTabs.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-type]');
      if (!button) return;
      state.filters.type = button.dataset.type;
      for (const tab of $$('button[data-type]', refs.typeTabs)) {
        tab.setAttribute('aria-pressed', String(tab === button));
      }
      renderEntries();
    });

    refs.categoryFilter.addEventListener('change', () => {
      state.filters.category = refs.categoryFilter.value;
      renderEntries();
    });

    refs.searchInput.addEventListener('input', () => {
      state.filters.query = refs.searchInput.value;
      renderEntries();
    });

    refs.clearFilters.addEventListener('click', () => {
      state.filters = { type: 'all', category: 'all', query: '' };
      refs.searchInput.value = '';
      refs.categoryFilter.value = 'all';
      for (const tab of $$('button[data-type]', refs.typeTabs)) {
        tab.setAttribute('aria-pressed', String(tab.dataset.type === 'all'));
      }
      renderEntries();
      refs.searchInput.focus();
    });
  }

  function setupDialogs() {
    for (const button of $$('[data-close]')) {
      button.addEventListener('click', () => closeDialog(button.closest('dialog')));
    }

    refs.entryForm.addEventListener('submit', handleEntrySubmit);
    refs.deleteEntry.addEventListener('click', handleDialogDelete);

    refs.typePicker.addEventListener('change', (event) => {
      if (event.target.name !== 'type') return;
      setEntryType(event.target.value);
      setError(refs.entryError);
    });

    refs.budgetForm.addEventListener('submit', handleBudgetSubmit);
    refs.removeBudget.addEventListener('click', handleBudgetRemove);
    refs.editBudget.addEventListener('click', openBudgetDialog);
    refs.budgetEmptyBtn.addEventListener('click', openBudgetDialog);

    refs.addEntry.addEventListener('click', () => openEntryDialog(null));
    refs.entriesEmptyAdd.addEventListener('click', () => openEntryDialog(null));
    refs.retryLoad.addEventListener('click', () => load());

    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'n' && event.key !== 'N') return;
      if (document.querySelector('dialog[open]')) return;

      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;

      event.preventDefault();
      openEntryDialog(null);
    });
  }

  function start() {
    setupAccount();
    setupMonthNavigation();
    setupFilters();
    setupDialogs();
    load();

  }

  return {
    start,
    refresh: load,
    get month() {
      return state.month;
    },
    destroy() {
      destroyDonut();
    },
  };
}
