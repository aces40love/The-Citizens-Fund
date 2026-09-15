(() => {
  'use strict';

  const dialog = document.getElementById('inquiry-dialog');
  const form = document.getElementById('inquiry-form');
  if (!dialog || !form) return;

  const steps = [...form.querySelectorAll('.inquiry-step')];
  const progress = [...dialog.querySelectorAll('.inquiry-progress li')];
  const backButton = form.querySelector('[data-inquiry-back]');
  const nextButton = form.querySelector('[data-inquiry-next]');
  const review = document.getElementById('inquiry-review');
  const summary = document.getElementById('inquiry-summary');
  const alert = document.getElementById('inquiry-validation');
  let currentStep = 0;
  let activeTrigger = null;

  const labels = [
    ['organization', 'Organization name'], ['website', 'Website'],
    ['organizationType', 'Organization type'], ['organizationOther', 'Other organization type'],
    ['contact', 'Full name'], ['role', 'Title / role'], ['email', 'Email address'], ['phone', 'Phone number'],
    ['focus', 'Area of focus'], ['description', 'About your organization'], ['community', 'Who you serve'],
    ['project', 'Project'], ['support', 'Support requested'], ['supportOther', 'Other type of support'],
    ['funding', 'Estimated funding need'], ['impact', 'Expected impact'], ['geography', 'Geographic area served'],
    ['stage', 'Project stage'], ['timeline', 'Anticipated timeline'], ['additional', 'Additional context']
  ];

  function showError(name, message) {
    const error = document.getElementById(`error-${name}`);
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
    for (const control of form.elements) {
      if (control.name === name) {
        if (message) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
      }
    }
  }

  function syncConditionalFields() {
    const data = new FormData(form);
    for (const wrapper of form.querySelectorAll('[data-other-field]')) {
      const active = data.getAll(wrapper.dataset.otherField).includes('Other');
      wrapper.hidden = !active;
      for (const input of wrapper.querySelectorAll('input')) {
        input.disabled = !active;
        input.required = active;
        if (!active) {
          input.setCustomValidity('');
          showError(input.name, '');
        }
      }
    }
  }

  function validateStep() {
    const step = steps[currentStep];
    const groupNames = new Set();
    for (const group of step.querySelectorAll('[data-required-group]')) {
      const name = group.dataset.requiredGroup;
      groupNames.add(name);
      const controls = [...group.querySelectorAll('input')];
      const valid = controls.some(control => control.checked);
      showError(name, valid ? '' : 'Choose at least one option.');
    }
    for (const control of step.querySelectorAll('input, select, textarea')) {
      if (control.disabled || groupNames.has(control.name)) continue;
      control.setCustomValidity('');
      if (control.required && !control.value.trim()) control.setCustomValidity('Please complete this field.');
      const valid = control.checkValidity();
      let message = '';
      if (!valid) {
        if (control.validity.typeMismatch && control.type === 'email') message = 'Enter a valid email address.';
        else if (control.validity.typeMismatch && control.type === 'url') message = 'Enter a full website address, starting with https://.';
        else message = 'Please complete this field.';
      }
      showError(control.name, message);
    }
    const firstInvalid = step.querySelector('[aria-invalid="true"]');
    alert.hidden = !firstInvalid;
    alert.textContent = firstInvalid ? 'Please complete the highlighted fields to continue.' : '';
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  function showStep(index, focus = true) {
    currentStep = index;
    form.hidden = false;
    review.hidden = true;
    steps.forEach((step, i) => { step.hidden = i !== index; });
    progress.forEach((item, i) => {
      item.classList.toggle('is-complete', i < index);
      if (i === index) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    backButton.hidden = index === 0;
    nextButton.textContent = index === steps.length - 1 ? 'Review inquiry ↗' : 'Continue ↗';
    alert.hidden = true;
    alert.textContent = '';
    if (focus) steps[index].querySelector('h3').focus();
  }

  function inquiryEntries() {
    const data = new FormData(form);
    return labels.map(([name, label]) => [label, data.getAll(name).map(value => String(value).trim()).filter(Boolean).join(', ')])
      .filter(([, value]) => value);
  }

  function showReview() {
    summary.replaceChildren();
    for (const [label, value] of inquiryEntries()) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      summary.append(term, description);
    }
    form.hidden = true;
    review.hidden = false;
    progress.forEach(item => {
      item.removeAttribute('aria-current');
      item.classList.add('is-complete');
    });
    document.getElementById('inquiry-review-title').focus();
  }

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest('[data-open-inquiry]');
    if (!trigger) return;
    event.preventDefault();
    const focusArea = trigger.dataset.focus || trigger.dataset.focusArea;
    if (focusArea) {
      for (const input of form.querySelectorAll('input[name="focus"]')) {
        if (input.value === focusArea) input.checked = true;
      }
    }
    if (!dialog.open) {
      activeTrigger = trigger;
      dialog.showModal();
      document.body.classList.add('dialog-open');
    }
    if (!review.hidden) showReview();
  });

  dialog.querySelector('[data-close-inquiry]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    const focusTarget = activeTrigger?.getClientRects().length ? activeTrigger : document.querySelector('.menu-toggle');
    focusTarget?.focus({ preventScroll: true });
  });
  backButton.addEventListener('click', () => showStep(Math.max(0, currentStep - 1)));
  dialog.querySelector('[data-inquiry-edit]').addEventListener('click', () => showStep(0));

  form.addEventListener('input', event => {
    const control = event.target;
    if (!control.name) return;
    if (typeof control.setCustomValidity === 'function') control.setCustomValidity('');
    showError(control.name, '');
  });
  form.addEventListener('change', syncConditionalFields);
  form.addEventListener('submit', event => {
    event.preventDefault();
    syncConditionalFields();
    if (!validateStep()) return;
    if (currentStep < steps.length - 1) showStep(currentStep + 1);
    else showReview();
  });

  dialog.querySelector('[data-inquiry-download]').addEventListener('click', () => {
    const content = [
      'THE CITIZENS FUND — INQUIRY DRAFT',
      'Prepared locally. This inquiry has not been submitted.',
      'Submit through the official form:',
      'https://cbnbankprod.wpenginepowered.com/citizens-bank-foundation/#gform_wrapper_3',
      '',
      ...inquiryEntries().map(([label, value]) => `${label}\n${value}\n`)
    ].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'citizens-fund-inquiry.txt';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.getElementById('inquiry-download-status').textContent = 'Your inquiry download is ready. Your information has not been submitted.';
  });

  syncConditionalFields();
  showStep(0, false);
})();
