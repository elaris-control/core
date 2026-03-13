// public/theme.js
(function(){
  const KEY = "elaris_theme";

  function apply(theme){
    const t = (theme === "dark") ? "dark" : "light";
    document.documentElement.dataset.theme = t;
    try{ localStorage.setItem(KEY, t); }catch(e){}
    document.querySelectorAll("#themeBtn").forEach(b=>{ b.textContent = (t === "dark") ? "☀️" : "🌙"; });
    // helps native controls look right in dark mode
    document.documentElement.style.colorScheme = (t === "dark") ? "dark" : "light";
  }

  function current(){
    try{ return (localStorage.getItem(KEY) === "dark") ? "dark" : "light"; }
    catch(e){ return "light"; }
  }

  function init(){
    apply(current());
  }

  // expose
  window.ELARIS_THEME = { apply, current, init };

  // auto init
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})();

window.toggleTheme = function(){
  try{
    const current = (window.ELARIS_THEME && ELARIS_THEME.current) ? ELARIS_THEME.current() :
      (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    const next = current === 'dark' ? 'light' : 'dark';
    if (window.ELARIS_THEME && ELARIS_THEME.apply) return ELARIS_THEME.apply(next);
    document.documentElement.dataset.theme = next;
    try{ localStorage.setItem('elaris_theme', next); }catch(e){}
    const b = document.getElementById('themeBtn');
    if(b) b.textContent = next === 'dark' ? '☀️' : '🌙';
  }catch(e){}
};
