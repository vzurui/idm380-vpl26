const form = document.getElementById("subForm");
const errorSummary = document.getElementById("formErrors");

form.addEventListener("submit", (e) => {
  e.preventDefault();

  let firstInvalid = null;
  const errors = [];

  // required inputs + required checkboxes
  const requiredFields = form.querySelectorAll("input[required]");

  requiredFields.forEach((field) => {
    const errorId = field.getAttribute("aria-describedby");
    const errorEl = errorId ? document.getElementById(errorId) : null;

    if (!field.checkValidity()) {
      field.setAttribute("aria-invalid", "true");
      if (errorEl) errorEl.hidden = false;

      if (!firstInvalid) firstInvalid = field;

      if (errorEl && errorEl.textContent) errors.push(errorEl.textContent);
    } else {
      field.removeAttribute("aria-invalid");
      if (errorEl) errorEl.hidden = true;
    }
  });

  if (errors.length) {
    errorSummary.innerHTML =
      "<p>Please fix the following:</p><ul>" +
      errors.map((msg) => `<li>${msg}</li>`).join("") +
      "</ul>";
    errorSummary.hidden = false;
    firstInvalid.focus();
    return;
  }

  errorSummary.hidden = true;
  form.submit();
});
