if (window.lucide) window.lucide.createIcons();

const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const fragmentTarget = (href) => {
  if (!href?.startsWith("#") || href === "#") return null;
  try {
    return document.getElementById(decodeURIComponent(href.slice(1)));
  } catch {
    return null;
  }
};

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const href = anchor.getAttribute("href");
    const target = fragmentTarget(href);
    if (target) {
      event.preventDefault();
      if (window.location.hash !== href) {
        window.history.pushState(null, "", href);
      }
      target.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  });
});

// Static Pages keeps trial CTAs on pricing because /app/* is its rollback
// prototype. Promote them only when this origin proves signup is configured.
(async function enableRuntimeSignupCtas() {
  try {
    const response = await fetch("/api/health/configuration", {
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
      payload?.data?.app?.configured !== true ||
      payload?.data?.database?.configured !== true ||
      payload?.data?.email?.configured !== true
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
// Do not install inline reveal transitions when reduced motion is requested.
if (!reducedMotion) {
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
}

const mobileButton = document.getElementById("mobHamburger");
const mobileMenu = document.getElementById("mobileMenu");
if (mobileButton && mobileMenu) {
  const closeMobileMenu = () => {
    mobileMenu.classList.remove("open");
    mobileButton.classList.remove("open");
    mobileButton.setAttribute("aria-expanded", "false");
  };

  mobileButton.addEventListener("click", () => {
    const open = mobileMenu.classList.toggle("open");
    mobileButton.classList.toggle("open", open);
    mobileButton.setAttribute("aria-expanded", open ? "true" : "false");
  });

  mobileMenu.querySelectorAll("a").forEach((anchor) => {
    anchor.addEventListener("click", () => {
      closeMobileMenu();
      const href = anchor.getAttribute("href");
      const target = fragmentTarget(href);
      if (target) {
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
        }
        target.focus({ preventScroll: true });
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileMenu.classList.contains("open")) {
      closeMobileMenu();
      if (mobileMenu.contains(document.activeElement)) {
        mobileButton.focus({ preventScroll: true });
      }
    }
  });
}
