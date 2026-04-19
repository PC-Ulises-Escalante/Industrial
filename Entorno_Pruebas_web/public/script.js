gsap.registerPlugin(ScrollTrigger);

document.addEventListener("DOMContentLoaded", () => {

    // ═══════════════════════════════════════════
    // SMOOTH SCROLL (Lenis)
    // ═══════════════════════════════════════════
    const lenis = new Lenis({
        lerp: 0.1,
        wheelMultiplier: 0.8
    });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => {
        lenis.raf(time * 1000);
    });
    // Keep lagSmoothing ON (default) — setting it to 0 disables it and causes jank

    // ═══════════════════════════════════════════
    // PARTICLES — reduced to 14 (from 26)
    // ═══════════════════════════════════════════
    const particlesContainer = document.getElementById("particles");
    if (particlesContainer) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 14; i++) {
            const span = document.createElement("span");
            span.classList.add("particle");
            span.style.left = `${(i * 23) % 100}%`;
            span.style.top = `${(i * 37) % 100}%`;
            const size = 2 + (i % 3);
            span.style.width = `${size}px`;
            span.style.height = `${size}px`;
            span.style.setProperty("--duration", `${10 + (i % 5)}s`);
            span.style.setProperty("--delay", `${(i % 5) * 0.5}s`);
            frag.appendChild(span);
        }
        particlesContainer.appendChild(frag);
    }

    // ═══════════════════════════════════════════
    // NAVBAR — use ScrollTrigger instead of raw scroll listener
    // ═══════════════════════════════════════════
    const navbar = document.getElementById("navbar");

    if (navbar) {
        ScrollTrigger.create({
            start: 60,
            onUpdate: (self) => {
                navbar.classList.toggle("scrolled", self.scroll() > 60);
            }
        });
    }

    // Active nav link — use Intersection Observer (much cheaper than scroll listener)
    const navLinks = document.querySelectorAll(".nav-link");
    const sectionEls = document.querySelectorAll("section[id], .dashboard[id], footer[id]");

    if (sectionEls.length > 0 && navLinks.length > 0) {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const id = entry.target.getAttribute("id");
                        navLinks.forEach((link) => {
                            link.classList.toggle(
                                "active",
                                link.getAttribute("href") === `#${id}`
                            );
                        });
                    }
                });
            },
            { rootMargin: "-40% 0px -55% 0px" }
        );
        sectionEls.forEach((el) => observer.observe(el));
    }

    // ═══════════════════════════════════════════
    // SCROLL REVEAL — batched, simpler
    // ═══════════════════════════════════════════
    gsap.utils.toArray(".sidebar-section, .footer-section").forEach((el) => {
        gsap.from(el, {
            scrollTrigger: {
                trigger: el,
                start: "top 88%",
                toggleActions: "play none none none"
            },
            opacity: 0,
            y: 24,
            duration: 0.5,
            ease: "power2.out"
        });
    });

    // ═══════════════════════════════════════════
    // DASHBOARD — Staggered Eje Cards
    // ═══════════════════════════════════════════
    const ejeCards = gsap.utils.toArray(".eje-card");
    if (ejeCards.length) {
        gsap.from(ejeCards, {
            scrollTrigger: {
                trigger: ".ejes-grid",
                start: "top 85%",
                toggleActions: "play none none none"
            },
            opacity: 0,
            y: 40,
            scale: 0.95,
            duration: 0.6,
            stagger: 0.12,
            ease: "power3.out"
        });
    }

    // ═══════════════════════════════════════════
    // DASHBOARD — Theme Mini Cards staggered
    // ═══════════════════════════════════════════
    const themeMiniCards = gsap.utils.toArray(".theme-mini-card");
    if (themeMiniCards.length) {
        gsap.from(themeMiniCards, {
            scrollTrigger: {
                trigger: ".themes-mini-grid",
                start: "top 90%",
                toggleActions: "play none none none"
            },
            opacity: 0,
            y: 20,
            scale: 0.9,
            duration: 0.5,
            stagger: 0.08,
            ease: "back.out(1.4)"
        });
    }

    // ═══════════════════════════════════════════
    // DASHBOARD — Schedule Items staggered
    // ═══════════════════════════════════════════
    const scheduleItems = gsap.utils.toArray(".schedule-item");
    if (scheduleItems.length) {
        gsap.from(scheduleItems, {
            scrollTrigger: {
                trigger: ".schedule-list",
                start: "top 88%",
                toggleActions: "play none none none"
            },
            opacity: 0,
            x: -30,
            duration: 0.5,
            stagger: 0.1,
            ease: "power2.out"
        });
    }

    // ═══════════════════════════════════════════
    // DASHBOARD — Speaker Cards staggered
    // ═══════════════════════════════════════════
    const speakerCards = gsap.utils.toArray(".sidebar .speaker-card");
    if (speakerCards.length) {
        gsap.from(speakerCards, {
            scrollTrigger: {
                trigger: ".speakers-grid",
                scroller: ".sidebar",
                start: "top 90%",
                toggleActions: "play none none none"
            },
            opacity: 0,
            y: 20,
            scale: 0.9,
            duration: 0.45,
            stagger: 0.07,
            ease: "back.out(1.2)",
            immediateRender: false
        });
    }

    // ═══════════════════════════════════════════
    // DASHBOARD — Animated Progress Bars
    // ═══════════════════════════════════════════
    const barFills = document.querySelectorAll(".schedule-bar-fill[data-width]");
    if (barFills.length) {
        const barObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const w = el.getAttribute("data-width");
                    el.style.width = w + "%";
                    barObserver.unobserve(el);
                }
            });
        }, { threshold: 0.3 });
        barFills.forEach((bar) => barObserver.observe(bar));
    }

    // ═══════════════════════════════════════════
    // DASHBOARD — Counter Animation (Footer Stats)
    // ═══════════════════════════════════════════
    const statNums = document.querySelectorAll(".footer-stat-num[data-count]");
    if (statNums.length) {
        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.getAttribute("data-count"), 10);
                    gsap.to(el, {
                        innerText: target,
                        duration: 1.2,
                        snap: { innerText: 1 },
                        ease: "power2.out"
                    });
                    counterObserver.unobserve(el);
                }
            });
        }, { threshold: 0.5 });
        statNums.forEach((el) => counterObserver.observe(el));
    }

    const cards = document.querySelectorAll(".sticky-cards .card");
    const totalCards = cards.length;

    if (totalCards > 0) {
        const scrollSegments = Math.max(totalCards - 1, 1);
        const segmentSize = 1 / scrollSegments;
        const cardYOffset = 20;
        const cardScaleStep = 0.05;

        cards.forEach((card, i) => {
            gsap.set(card, {
                xPercent: -50,
                yPercent: -50 + (i * cardYOffset),
                scale: 1 - (i * cardScaleStep),
            });
        });

        ScrollTrigger.create({
            trigger: ".sticky-cards",
            start: "top top",
            end: `+=${window.innerHeight * scrollSegments}px`,
            pin: true,
            pinSpacing: true,
            scrub: 0.5,
            onUpdate: (self) => {
                const progress = self.progress;
                const activeIndex = Math.min(
                    Math.floor(progress / segmentSize),
                    scrollSegments - 1
                );
                const segProgress = (progress - (activeIndex * segmentSize)) / segmentSize;

                cards.forEach((card, i) => {
                    if (i === activeIndex) {
                        gsap.set(card, {
                            yPercent: gsap.utils.interpolate(-50, -200, segProgress),
                            rotationX: gsap.utils.interpolate(0, 35, segProgress),
                            scale: 1,
                        });
                    } else if (i < activeIndex) {
                        gsap.set(card, {
                            yPercent: -200,
                            rotationX: 35,
                            scale: 1,
                        });
                    } else {
                        const behindIndex = i - activeIndex;
                        const currentYOffset = (behindIndex - segProgress) * cardYOffset;
                        const currentScale = 1 - (behindIndex - segProgress) * cardScaleStep;

                        gsap.set(card, {
                            yPercent: -50 + currentYOffset,
                            rotationX: 0,
                            scale: currentScale,
                        });
                    }
                });
            }
        });
    }
});