import confetti from "canvas-confetti";

export const triggerBrassBurst = (x: number, y: number) => {
  confetti({
    particleCount: 40,
    spread: 60,
    origin: { 
      x: x / window.innerWidth, 
      y: y / window.innerHeight 
    },
    colors: ["#B8860B", "#DAA520", "#F5DEB3", "#1A1A1A"],
    disableForReducedMotion: true,
    zIndex: 100,
    scalar: 0.8,
    ticks: 100
  });
};

export const triggerSavingsCelebration = () => {
  const duration = 2800;
  const end = Date.now() + duration;

  const frame = () => {
    confetti({
      particleCount: 5,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ["#B8860B", "#DAA520", "#F5DEB3"]
    });
    confetti({
      particleCount: 5,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ["#B8860B", "#DAA520", "#F5DEB3"]
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  };
  frame();
};
