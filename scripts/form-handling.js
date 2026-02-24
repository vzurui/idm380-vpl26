const form = document.getElementById("subForm");
const successMessage = document.getElementById("formSuccess");

function getErrorEl(field) {
  const describedBy = field.getAttribute("aria-describedby") || "";
  const ids = describedBy.trim().split(/\s+/);
  const errorId = ids.find((id) => id.includes("error"));
  return errorId ? document.getElementById(errorId) : null;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();

  // hide success whenever the user tries again
  if (successMessage) successMessage.hidden = true;

  const requiredFields = form.querySelectorAll("input[required]");
  let firstInvalid = null;

  requiredFields.forEach((field) => {
    const errorEl = getErrorEl(field);

    if (!field.checkValidity()) {
      field.setAttribute("aria-invalid", "true");
      if (errorEl) errorEl.hidden = false;

      if (!firstInvalid) firstInvalid = field;
    } else {
      field.removeAttribute("aria-invalid");
      if (errorEl) errorEl.hidden = true;
    }
  });

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  // ✅ Success state
  form.reset();
  if (successMessage) successMessage.hidden = false;
});
