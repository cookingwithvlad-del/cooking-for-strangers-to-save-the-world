(() => {
  const canvas = document.getElementById("game");
  const input = new Input();
  const ui = new UI();
  const game = new Game(canvas, ui, input);
  window.game = game;

  const resize = () => game.renderer.resize();
  addEventListener("resize", resize);
  resize();

  document.getElementById("controls-text").innerHTML = ui.controlsHtml(false);
  ui.showTitle(hasSave());

  addEventListener("keydown", () => sfx.unlock(), { once: true });
  addEventListener("beforeunload", () => { if (game.state === "play" || game.state === "paused" || game.state === "modal") game.saveGame(false); });

  let last = performance.now();
  const loop = now => {
    const dt = (now - last) / 1000; last = now;
    game.update(dt);
    game.renderer.draw();
    input.endFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
