const form = document.getElementById("subForm");

function getErrorEl(field) {
  const describedBy = field.getAttribute("aria-describedby") || "";
  const ids = describedBy.trim().split(/\s+/);
  const errorId = ids.find((id) => id.includes("error"));
  return errorId ? document.getElementById(errorId) : null;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const requiredFields = form.querySelectorAll(
    "input[required], textarea[required]",
  );
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

  form.reset();
});
