/* Day/night theme toggle. The initial theme is applied by an inline script in
   index.html before first paint; this file only wires the topbar button. */
(function () {
  var btn = document.getElementById("theme-toggle");
  if (!btn) {
    return;
  }
  btn.addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "night" ? "day" : "night";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("ainovel-theme", next);
    } catch (err) {
      /* Private mode may block storage; the toggle still works for this page. */
    }
  });
})();
