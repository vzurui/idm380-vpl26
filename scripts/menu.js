const header = document.querySelector(".site-header");
const btn = document.querySelector(".nav-toggle");

btn.addEventListener("click", () => {
  const isOpen = header.classList.toggle("nav-open");
  btn.setAttribute("aria-expanded", String(isOpen));
  btn.setAttribute("aria-label", isOpen ? "Close main menu" : "Open main menu");
});
