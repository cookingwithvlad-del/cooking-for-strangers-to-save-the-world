(() => {
  const canvas = document.getElementById("game");
  const input = new Input();
  const ui = new UI();
  const game = new Game(canvas, ui, input);
  window.game = game;
  let prefer2d = /[?&]2d/.test(location.search);
  try { prefer2d = prefer2d || localStorage.getItem("cfs-2d") === "1"; } catch (e) {}
  if (window.THREE && !prefer2d) {
    try { game.renderer = new Renderer3D(canvas, game); }
    catch (e) { console.warn("3D unavailable, using the 2D renderer:", e); }
  }
  game.is3d = game.renderer instanceof Renderer3D;

  const resize = () => game.renderer.resize();
  addEventListener("resize", resize);
  resize();

  document.getElementById("controls-text").innerHTML = ui.controlsHtml(false);
  ui.showTitle(hasSave());

  const tv = document.getElementById("title-video"), titleEl = document.getElementById("title");
  const playlist = ["assets/title-1.mp4", "assets/title-2.mp4"];
  let clip = 0;
  const dropVideo = () => { tv.remove(); titleEl.classList.remove("has-video"); };
  tv.addEventListener("playing", () => { tv.classList.add("on"); titleEl.classList.add("has-video"); });
  tv.addEventListener("ended", () => { clip = (clip + 1) % playlist.length; tv.src = playlist[clip]; tv.play().catch(() => {}); });
  tv.addEventListener("error", dropVideo);
  tv.play().catch(() => {});
  setTimeout(() => { if (tv.readyState < 3 || tv.paused) dropVideo(); }, 4000);

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
