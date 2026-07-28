if (window.lucide) window.lucide.createIcons();

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("#") || href === "#") return;
    const target = document.querySelector(href);
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// Static Pages keeps trial CTAs on pricing because /app/* is its rollback
// prototype. Promote them only when this origin proves the Worker is active.
(async function enableRuntimeSignupCtas() {
  try {
    const response = await fetch("/api/health", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      return;
    }
    const payload = await response.json();
    if (
      payload?.data?.service !== "vinifera-api" ||
      payload?.data?.status !== "ok"
    ) {
      return;
    }
    document.querySelectorAll("[data-signup-cta]").forEach((anchor) => {
      anchor.setAttribute("href", "/app/signup");
    });
  } catch {
    // Preserve the safe pricing fallback when the runtime is unavailable.
  }
})();

// Text remains fully opaque so contrast is stable throughout the transition.
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.style.transform = "translateY(0)";
    });
  },
  { threshold: 0.1 },
);
document
  .querySelectorAll(
    ".feature-card, .problem-card, .workflow-step, .testimonial-card, .pricing-card, .ai-feature",
  )
  .forEach((element) => {
    element.style.transform = "translateY(18px)";
    element.style.transition = "transform 0.5s ease";
    observer.observe(element);
  });

const mobileButton = document.getElementById("mobHamburger");
const mobileMenu = document.getElementById("mobileMenu");
if (mobileButton && mobileMenu) {
  mobileButton.addEventListener("click", () => {
    const open = mobileMenu.classList.toggle("open");
    mobileButton.classList.toggle("open", open);
    mobileButton.setAttribute("aria-expanded", open ? "true" : "false");
  });

  mobileMenu.querySelectorAll("a").forEach((anchor) => {
    anchor.addEventListener("click", () => {
      mobileMenu.classList.remove("open");
      mobileButton.classList.remove("open");
      mobileButton.setAttribute("aria-expanded", "false");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      mobileMenu.classList.remove("open");
      mobileButton.classList.remove("open");
      mobileButton.setAttribute("aria-expanded", "false");
    }
  });
}
